import * as k8s from '@pulumi/kubernetes'
import * as pulumi from '@pulumi/pulumi'
import { Cluster } from '@pulumi/eks'

export interface deploymentArgs {
    namespace: pulumi.Input<string>
    cluster: Cluster
}

export class Deployment extends k8s.helm.v3.Chart {
    constructor(name: string, args: deploymentArgs, opts?: pulumi.ComponentResourceOptions) {
        super(
            `${name}-node-termination-handler`,
            {
                // https://github.com/aws/aws-node-termination-handler/tree/main/config/helm/aws-node-termination-handler
                chart: 'oci://public.ecr.aws/aws-ec2/helm/aws-node-termination-handler',
                namespace: args.namespace,
                version: '0.27.2',
                values: {
                    enableSpotInterruptionDraining: 'true',
                    enableRebalanceDraining: 'false',
                    enableScheduledEventDraining: 'false',
                    podTerminationGracePeriod: '-1', //  If negative, the default value specified in the pod will be used
                    nodeTerminationGracePeriod: '120',
                    enablePrometheusServer: 'false',
                    emitKubernetesEvents: 'true'
                }
            },
            { ...opts, parent: args.cluster }
        )
    }
}
