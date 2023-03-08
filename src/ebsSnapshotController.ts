import * as aws from '@pulumi/aws'
import * as k8s from '@pulumi/kubernetes'
import * as pulumi from '@pulumi/pulumi'
import * as kubernetes from '@pulumi/kubernetes'

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
                // https://github.com/piraeusdatastore/helm-charts
                repo: 'piraeus-charts',
                chart: 'snapshot-controller',
                namespace: args.namespace,
                version: '1.7.2',
                values: {
                    controller: {
                        region: args.providers.aws.region
                    }
                }
            },
            { ...opts, provider: args.providers.k8s }
        )

        new k8s.apiextensions.CustomResource('csi-aws-vsc', {
            apiVersion: 'snapshot.storage.k8s.io/v1',
            kind: 'VolumeSnapshotClass',
            metadata: {
                name: 'csi-aws-vsc'
            },
            driver: 'ebs.csi.aws.com',
            deletionPolicy: 'Delete'
        }, { parent: this, dependsOn: this })
    }
}
