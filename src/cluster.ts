import * as aws from '@pulumi/aws'
import * as awsx from '@pulumi/awsx'
import * as eks from '@pulumi/eks'
import * as pulumi from '@pulumi/pulumi'
import { ComponentResourceOptions } from '@pulumi/pulumi'

export type ComponentResourceOptionsWithProvider = ComponentResourceOptions & {
    provider: aws.Provider
}

export default async (
    name: string,
    vpc: awsx.ec2.Vpc,
    instanceTypes: aws.ec2.InstanceType[],
    opts: ComponentResourceOptionsWithProvider
) => {
    const tags = { iac: `pulumi-${name}` }

    const privateSubnets = await vpc.privateSubnets
    const publicSubnetIds = await vpc.publicSubnetIds
    const privateSubnetIds = await vpc.privateSubnetIds

    const profileName = opts.provider.profile as pulumi.Output<string>

    const cluster = new eks.Cluster(
        name,
        {
            vpcId: vpc.id,
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
        opts
    )

    privateSubnets.forEach(({ subnet }, index) => {
        new eks.ManagedNodeGroup(
            `${name}-${index}`,
            {
                cluster: cluster,
                instanceTypes,
                capacityType: 'SPOT',
                subnetIds: [subnet.id],
                nodeRole: cluster.instanceRoles[0],
                scalingConfig: {
                    maxSize: 3,
                    minSize: 1,
                    desiredSize: 1
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
                transformations: [
                    args => {
                        // This is to ignore scaling config in case of cluster-autoscaler
                        if (args.type === 'aws:eks/nodeGroup:NodeGroup') {
                            return {
                                props: args.props,
                                opts: pulumi.mergeOptions(args.opts, {
                                    ignoreChanges: ['scalingConfig']
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
