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
            `${name}-validation-webhook`,
            {
                // https://github.com/piraeusdatastore/helm-charts/tree/main/charts/snapshot-validation-webhook
                repo: 'piraeus-charts',
                chart: 'snapshot-validation-webhook',
                namespace: args.namespace,
                version: '1.7.1',
                skipCRDRendering: true,
                values: {
                    replicaCount: 1,
                    resources: {
                        limits: {
                            cpu: '50m',
                            memory: '100Mi'
                        }
                    }
                }
            },
            { ...opts, provider: args.providers.k8s }
        )
    }
}
