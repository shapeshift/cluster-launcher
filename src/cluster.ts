import * as aws from '@pulumi/aws'
import * as awsx from '@pulumi/awsx'
import * as eks from '@pulumi/eks'
import * as pulumi from '@pulumi/pulumi'
import { ComponentResourceOptions } from '@pulumi/pulumi'

export type ComponentResourceOptionsWithProvider = ComponentResourceOptions & {
    provider: aws.Provider
}

interface ClusterArgs {
    vpc: awsx.ec2.Vpc
    instanceTypes: aws.ec2.InstanceType[]
    numberOfInstancesPerAz: number
    autoscaling: {
        minInstances: number
        maxInstances: number
    },
    enabledClusterAutoscaler: boolean
}

export default async function (name: string, args: ClusterArgs, opts: ComponentResourceOptionsWithProvider) {
    const tags = { iac: `pulumi-${name}` }

    const privateSubnets = await args.vpc.privateSubnets
    const publicSubnetIds = await args.vpc.publicSubnetIds
    const privateSubnetIds = await args.vpc.privateSubnetIds

    const profileName = opts.provider.profile as pulumi.Output<string>

    const cluster = new eks.Cluster(
        name,
        {
            vpcId: args.vpc.id,
            skipDefaultNodeGroup: true,
            maxSize: 0, // We are using SPOT instance managed node groups instead
            minSize: 0, // We are using SPOT instance managed node groups instead
            desiredCapacity: 0, // We are using SPOT instance managed node groups instead
            subnetIds: [...publicSubnetIds, ...privateSubnetIds],
            providerCredentialOpts: { profileName },

            tags
        },
        opts
    )

    const launchTemplates = new aws.ec2.LaunchTemplate(
        name,
        {
            description: `${name} launch template for eks worker nodes (managed by pulumi)`,
            vpcSecurityGroupIds: [cluster.nodeSecurityGroup.id],
            blockDeviceMappings: [
                {
                    ebs: {
                        deleteOnTermination: 'true',
                        volumeSize: 20
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

    privateSubnets.forEach(({ subnet }, index) => {
        new eks.ManagedNodeGroup(
            `${name}-${index}`,
            {
                cluster: cluster,
                instanceTypes: args.instanceTypes,
                capacityType: 'SPOT',
                subnetIds: [subnet.id],
                nodeRole: cluster.instanceRoles[0],
                scalingConfig: {
                    maxSize: args.autoscaling.maxInstances,
                    minSize: args.autoscaling.minInstances,
                    desiredSize: args.numberOfInstancesPerAz
                },
                tags: {
                    Name: `${name}-eks-worker`,
                    ...tags
                },
                launchTemplate: {
                    version: pulumi.interpolate`${launchTemplates.latestVersion}`,
                    name: launchTemplates.name
                }
            },
            {
                ...opts,
                parent: launchTemplates,
                transformations: [
                    manifest => {
                        // This is to ignore scaling config in case of cluster-autoscaler because it sets desiredSize
                        if (manifest.type === 'aws:eks/nodeGroup:NodeGroup' && args.enabledClusterAutoscaler) {
                            return {
                                props: manifest.props,
                                opts: pulumi.mergeOptions(manifest.opts, {
                                    ignoreChanges: ['scalingConfig.desiredSize']
                                })
                            }
                        }
                        return
                    }
                ]
            }
        )
    })

    return { kubeconfig: cluster.getKubeconfig({ profileName }), cluster }
}
