import * as aws from '@pulumi/aws'
import * as k8s from '@pulumi/kubernetes'
import * as pulumi from '@pulumi/pulumi'
import { Cluster } from '@pulumi/eks'

export interface dnsControllerArgs {
    zone: aws.route53.Zone
    cluster: Cluster
    namespace: pulumi.Input<string>
    providers: { aws: aws.Provider; k8s: k8s.Provider }
}

// Requires cert manager to be present beforehand
export class Deployment extends k8s.helm.v3.Chart {
    constructor(name: string, args: dnsControllerArgs, opts?: pulumi.ComponentResourceOptions) {
        super(
            `${name}-external-dns-helmchart`,
            {
                repo: 'bitnami',
                chart: 'external-dns',
                transformations: [(manifest: any) => (manifest.metadata.namespace = args.namespace)],
                namespace: args.namespace,
                version: '6.1.0',
                values: {
                    resources: {
                        limits: {
                            cpu: '50m',
                            memory: '100Mi'
                        },
                        requests: {
                            cpu: '50m',
                            memory: '100Mi'
                        }
                    },
                    domainFilters: [args.zone.name],
                    provider: 'aws',
                    registry: 'txt',
                    policy: 'sync',
                    txtOwnerId: name,
                    sources: ['service', 'ingress'],
                    rbac: {
                        create: true
                    },
                    aws: {
                        batchChangeSize: 100
                    }
                }
            },
            { ...opts, provider: args.providers.k8s }
        )

        // create iam role
        const iamPolicy = new aws.iam.Policy(
            `${name}-external-dns-role-policy`,
            {
                policy: pulumi
                    .output({
                        Version: '2012-10-17',
                        Statement: [
                            {
                                Effect: 'Allow',
                                Action: ['route53:ChangeResourceRecordSets'],
                                Resource: [pulumi.interpolate`arn:aws:route53:::hostedzone/${args.zone.id}`]
                            },
                            {
                                Effect: 'Allow',
                                Action: ['route53:ListHostedZones', 'route53:ListResourceRecordSets'],
                                Resource: ['*']
                            },
                            // next three sections are for cert-manager TODO) move to cert manager after
                            {
                                Effect: 'Allow',
                                Action: 'route53:GetChange',
                                Resource: 'arn:aws:route53:::change/*'
                            },
                            {
                                Effect: 'Allow',
                                Action: ['route53:ChangeResourceRecordSets', 'route53:ListResourceRecordSets'],
                                Resource: 'arn:aws:route53:::hostedzone/*'
                            },
                            {
                                Effect: 'Allow',
                                Action: 'route53:ListHostedZonesByName',
                                Resource: '*'
                            }
                        ]
                    })
                    .apply(JSON.stringify)
            },
            { ...opts, provider: args.providers.aws, parent: this }
        )

        new aws.iam.RolePolicyAttachment(
            name,
            {
                // TODO don't use instance role because it's sketch : https://github.com/kubernetes-sigs/external-dns/blob/master/docs/tutorials/aws.md#ec2-instance-role-not-recommended
                role: args.cluster.instanceRoles[0].name,
                policyArn: iamPolicy.arn
            },
            { ...opts, provider: args.providers.aws, parent: this }
        )
    }
}
