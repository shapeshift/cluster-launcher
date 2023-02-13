import * as aws from '@pulumi/aws'
import * as k8s from '@pulumi/kubernetes'
import * as pulumi from '@pulumi/pulumi'
import { Cluster } from '@pulumi/eks'

export interface deploymentArgs {
    namespace: pulumi.Input<string>
    cluster: Cluster
    providers: { aws: aws.Provider; k8s: k8s.Provider }
}

export class Deployment extends k8s.helm.v3.Chart {
    constructor(name: string, args: deploymentArgs, opts?: pulumi.ComponentResourceOptions) {
        super(
            `${name}-cluster-autoscaler`,
            {
                // https://github.com/kubernetes/autoscaler/tree/master/charts/cluster-autoscaler
                chart: 'cluster-autoscaler',
                repo: 'autoscaler',
                namespace: args.namespace,
                version: '9.23.0',
                values: {
                    autoDiscovery: {
                        clusterName: args.cluster.eksCluster.name
                    },
                    awsRegion: args.providers.aws.region,
                    extraArgs: {
                        'scale-down-delay-after-add': '10m', //amount of time to resume scale down after a node is added
                        'scale-down-unneeded-time': '10m', //once a node is deemed to be "unneeded", how much time passes until it is removed
                        'scale-down-utilization-threshold': '0.5', //CPU utilization (resources requested) threshold of a node to be considered "unneeded"
                        'scan-interval': '10s', //How often should the autoscaler evaluate the cluster for scaling changes
                        'max-empty-bulk-delete': '3', //How many vacant nodes can we remove at the same time?
                        'balance-similar-node-groups': true, //make sure node groups are balance between AZs (https://github.com/kubernetes/autoscaler/blob/master/cluster-autoscaler/FAQ.md#im-running-cluster-with-nodes-in-multiple-zones-for-ha-purposes-is-that-supported-by-cluster-autoscaler)
                        'skip-nodes-with-system-pods': false,
                        'max-graceful-termination-sec': '600' //Amount of time to allow a pod to terminate before killing
                    },
                    podAnnotations: {
                        'prometheus.io/port':'8085',
                        'prometheus.io/scrape':'true',
                    },
                    resources: {
                        limits: {
                            cpu: '300m',
                            memory: '500Mi'
                        }
                    }
                },
                transformations: [
                    (manifest: any) => {
                        // This is a hack, because extraArgs is a HashMap for the helm chart it can't use multiple keys with same name...
                        // IE it can't have flags that can be used multiple times with different values
                        // ISSUE: https://github.com/kubernetes/autoscaler/issues/3673
                        if (manifest.kind === 'Deployment') {
                            const flag = '--balancing-ignore-label'
                            manifest.spec.template.spec.containers[0].command.push(
                                `${flag}=topology.ebs.csi.aws.com/zone`
                            )
                            manifest.spec.template.spec.containers[0].command.push(
                                `${flag}=node.kubernetes.io/instance-type`
                            )
                            manifest.spec.template.spec.containers[0].command.push(
                                `${flag}=beta.kubernetes.io/instance-type`
                            )
                        }
                    }
                ]
            },
            { ...opts, parent: args.cluster, provider: args.providers.k8s }
        )

        const autoscalerPolicy = new aws.iam.Policy(
            'cluster-autoscaler-policy',
            {
                policy: {
                    Version: '2012-10-17',
                    Statement: [
                        {
                            Action: [
                                'autoscaling:DescribeAutoScalingGroups',
                                'autoscaling:DescribeAutoScalingInstances',
                                'autoscaling:DescribeLaunchConfigurations',
                                'autoscaling:DescribeTags',
                                'autoscaling:SetDesiredCapacity',
                                'autoscaling:TerminateInstanceInAutoScalingGroup',
                                'ec2:DescribeLaunchTemplateVersions'
                            ],
                            Resource: '*',
                            Effect: 'Allow'
                        }
                    ]
                }
            },
            { ...opts, parent: args.cluster, provider: args.providers.aws }
        )

        new aws.iam.RolePolicyAttachment(
            `eks-${name}-EKS-worker-node`,
            {
                policyArn: autoscalerPolicy.arn,
                role: args.cluster.instanceRoles[0]
            },
            { ...opts, parent: args.cluster, provider: args.providers.aws }
        )
    }
}
