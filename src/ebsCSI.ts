import * as aws from '@pulumi/aws'
import * as k8s from '@pulumi/kubernetes'
import * as pulumi from '@pulumi/pulumi'
import { Cluster } from '@pulumi/eks'

interface Args {
    cluster: Cluster
    namespace: pulumi.Input<string>
    providers: { aws: aws.Provider; k8s: k8s.Provider }
}

export class Deployment extends k8s.helm.v3.Chart {
    constructor(name: string, args: Args, opts?: pulumi.ComponentResourceOptions) {
        super(
            `${name}-ebs-csi-driver`,
            {
                // https://github.com/kubernetes-sigs/aws-ebs-csi-driver/tree/master/charts/aws-ebs-csi-driver
                repo: 'aws-ebs-csi-driver',
                chart: 'aws-ebs-csi-driver',
                namespace: args.namespace,
                version: '2.18.0',
                values: {
                    controller: {
                        region: args.providers.aws.region,
                    },
                }
            },
            { ...opts, provider: args.providers.k8s }
        )

        new k8s.storage.v1.StorageClass(
            'ebs-csi-gp2',
            {
                metadata: { name: 'ebs-csi-gp2' },
                provisioner: 'ebs.csi.aws.com',
                reclaimPolicy: 'Delete',
                volumeBindingMode: 'WaitForFirstConsumer',
                allowVolumeExpansion: true,
                parameters: {
                    type: 'gp2',
                    fsType: 'ext4'
                }
            },
            { ...opts, provider: args.providers.k8s, parent: this, deleteBeforeReplace: true }
        )

        const iamPolicy = new aws.iam.Policy(
            `${name}-aws-ebs-csi-driver-policy`,
            {
                policy: {
                    'Version': '2012-10-17',
                    'Statement': [
                        {
                            'Effect': 'Allow',
                            'Action': [
                                'ec2:CreateSnapshot',
                                'ec2:AttachVolume',
                                'ec2:DetachVolume',
                                'ec2:ModifyVolume',
                                'ec2:DescribeAvailabilityZones',
                                'ec2:DescribeInstances',
                                'ec2:DescribeSnapshots',
                                'ec2:DescribeTags',
                                'ec2:DescribeVolumes',
                                'ec2:DescribeVolumesModifications'
                            ],
                            'Resource': '*'
                        },
                        {
                            'Effect': 'Allow',
                            'Action': ['ec2:CreateTags'],
                            'Resource': ['arn:aws:ec2:*:*:volume/*', 'arn:aws:ec2:*:*:snapshot/*'],
                            'Condition': {
                                'StringEquals': { 'ec2:CreateAction': ['CreateVolume', 'CreateSnapshot'] }
                            }
                        },
                        {
                            'Effect': 'Allow',
                            'Action': ['ec2:DeleteTags'],
                            'Resource': ['arn:aws:ec2:*:*:volume/*', 'arn:aws:ec2:*:*:snapshot/*'
                            ]
                        },
                        {
                            'Effect': 'Allow',
                            'Action': ['ec2:CreateVolume'],
                            'Resource': '*',
                            'Condition': {
                                'StringLike': { 'aws:RequestTag/ebs.csi.aws.com/cluster': 'true' }
                            }
                        },
                        {
                            'Effect': 'Allow',
                            'Action': ['ec2:CreateVolume'],
                            'Resource': '*',
                            'Condition': {
                                'StringLike': { 'aws:RequestTag/CSIVolumeName': '*' }
                            }
                        },
                        {
                            'Effect': 'Allow',
                            'Action': ['ec2:DeleteVolume'],
                            'Resource': '*',
                            'Condition': {
                                'StringLike': { 'ec2:ResourceTag/ebs.csi.aws.com/cluster': 'true' }
                            }
                        },
                        {
                            'Effect': 'Allow',
                            'Action': ['ec2:DeleteVolume'],
                            'Resource': '*',
                            'Condition': {
                                'StringLike': { 'ec2:ResourceTag/CSIVolumeName': '*' }
                            }
                        },
                        {
                            'Effect': 'Allow',
                            'Action': ['ec2:DeleteVolume'],
                            'Resource': '*',
                            'Condition': {
                                'StringLike': { 'ec2:ResourceTag/kubernetes.io/created-for/pvc/name': '*' }
                            }
                        },
                        {
                            'Effect': 'Allow',
                            'Action': ['ec2:DeleteSnapshot'],
                            'Resource': '*',
                            'Condition': {
                                'StringLike': { 'ec2:ResourceTag/CSIVolumeSnapshotName': '*' }
                            }
                        },
                        {
                            'Effect': 'Allow',
                            'Action': ['ec2:DeleteSnapshot'],
                            'Resource': '*',
                            'Condition': {
                                'StringLike': { 'ec2:ResourceTag/ebs.csi.aws.com/cluster': 'true' }
                            }
                        }
                    ]
                }
            },
            { ...opts, provider: args.providers.aws, parent: this }
        )

        new aws.iam.RolePolicyAttachment(
            `${name}-ebs-csi-driver`,
            {
                role: args.cluster.instanceRoles[0],
                policyArn: iamPolicy.arn
            },
            { ...opts, provider: args.providers.aws, parent: this }
        )
    }
}
