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
            `${name}-snapshot-controller`,
            {
                // https://github.com/piraeusdatastore/helm-charts/tree/main/charts/snapshot-controller
                repo: 'piraeus-charts',
                chart: 'snapshot-controller',
                namespace: args.namespace,
                version: '1.7.1',
                skipCRDRendering: true,
                values: {
                    replicaCount: 3,
                    resources: {
                        limits: {
                            cpu: '50m',
                            memory: '100Mi'
                        }
                    },
                    volumeSnapshotClasses: [
                        {
                            name: 'csi-aws-vsc',
                            annotations: {
                                "snapshot.storage.kubernetes.io/is-default-class": "true"
                            },
                            driver: 'ebs.csi.aws.com',
                            deletionPolicy: 'Delete'
                        }
                    ]
                }
            },
            { ...opts, provider: args.providers.k8s }
        )
    }
}
