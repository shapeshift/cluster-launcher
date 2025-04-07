import * as aws from '@pulumi/aws'
import * as awsx from '@pulumi/awsx'
import * as eks from '@pulumi/eks'
import * as pulumi from '@pulumi/pulumi'
import { ComponentResourceOptions } from '@pulumi/pulumi'
import { nodeGroups } from '.'

export type ComponentResourceOptionsWithProvider = ComponentResourceOptions & {
    provider: aws.Provider
}

interface ClusterArgs {
    vpc: awsx.ec2.Vpc
    nodeGroups: nodeGroups[]
    clusterAutoscaler: boolean
    volumeSize: number
}

export default function (name: string, args: ClusterArgs, opts: ComponentResourceOptionsWithProvider) {
    const tags = { iac: `pulumi-${name}` }

    const subnetIds = pulumi.all([args.vpc.privateSubnetIds, args.vpc.publicSubnetIds])
        .apply(([privateSubnetIds, publicSubnetIds]) => [...privateSubnetIds, ...publicSubnetIds])

    const profileName = opts.provider.profile as pulumi.Output<string>

    const cluster = new eks.Cluster(
        name,
        {
            vpcId: args.vpc.vpcId,
            createInstanceRole: true,
            skipDefaultNodeGroup: true,
            authenticationMode: eks.AuthenticationMode.ConfigMap,
            maxSize: 0, // We are using SPOT instance managed node groups instead
            minSize: 0, // We are using SPOT instance managed node groups instead
            desiredCapacity: 0, // We are using SPOT instance managed node groups instead
            subnetIds,
            corednsAddonOptions: { enabled: true },
            kubeProxyAddonOptions: { enabled: true },
            providerCredentialOpts: { profileName },
            tags
        },
        opts
    )

    const launchTemplates = new aws.ec2.LaunchTemplate(
        name,
        {
            description: `${name} launch template for eks worker nodes (managed by pulumi)`,
            vpcSecurityGroupIds: cluster.nodeSecurityGroup.apply(sg => sg ? [sg.id] : []),
            blockDeviceMappings: [
                {
                    ebs: {
                        deleteOnTermination: 'true',
                        iops: 3000,
                        throughput: 125,
                        volumeSize: args.volumeSize,
                        volumeType: 'gp3'
                    },
                    deviceName: '/dev/xvda'
                }
            ],
            ebsOptimized: 'true',
            tagSpecifications: [
                {
                    resourceType: 'instance',
                    tags: {
                        Name: `${name}-eks-worker`,
                        ...tags
                    }
                }
            ]
        },
        { ...opts, parent: cluster }
    )

    args.nodeGroups.forEach(nodeGroup => {
        args.vpc.privateSubnetIds.apply(ids => {
            ids.forEach((id, index) => {
                new eks.ManagedNodeGroup(
                    `${name}-${index}-${nodeGroup.name}`,
                    {
                        cluster: cluster,
                        instanceTypes: nodeGroup.instanceTypes,
                        capacityType: nodeGroup.type,
                        subnetIds: [id],
                        nodeRole: cluster.instanceRoles[0],
                        labels: {
                            'nodeGroup': `${name}-${nodeGroup.name}`
                        },
                        scalingConfig: {
                            maxSize: nodeGroup.maxSize,
                            minSize: nodeGroup.minSize,
                            desiredSize: nodeGroup.desired
                        },
                        tags: {
                            Name: `${name}-${nodeGroup.name}-eks-worker`,
                            ...tags
                        },
                        launchTemplate: {
                            version: pulumi.interpolate`${launchTemplates.latestVersion}`,
                            name: launchTemplates.name
                        }
                    },
                    { ...opts, parent: launchTemplates }
                )

            })
        })
    })

    return { cluster }
}
