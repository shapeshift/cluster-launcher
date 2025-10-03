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
                // https://github.com/bitnami/charts/tree/main/bitnami/external-dns
                chart: 'oci://registry-1.docker.io/bitnamicharts/external-dns',
                transformations: [(manifest: any) => (manifest.metadata.namespace = args.namespace)],
                namespace: args.namespace,
                version: '9.0.3',
                values: {
                    image: {
                        repository: 'bitnamilegacy/external-dns'
                    },
                    resources: {
                        limits: {
                            cpu: '50m',
                            memory: '100Mi'
                        },
                    },
                    domainFilters: [args.zone.name],
                    provider: 'aws',
                    registry: 'txt',
                    policy: 'sync',
                    txtOwnerId: name,
                    sources: ['service', 'ingress']
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
                policyArn: iamPolicy.arn,
                role: args.cluster.instanceRoles[0],
            },
            { ...opts, provider: args.providers.aws, parent: this }
        )
    }
}
