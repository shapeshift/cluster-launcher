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
                // https://github.com/aws/eks-charts/tree/master/stable/aws-node-termination-handler
                chart: 'aws-node-termination-handler',
                repo: 'eks',
                namespace: args.namespace,
                version: '0.15.3',
                values: {
                    enableSpotInterruptionDraining: 'true',
                    enableRebalanceDraining: 'false',
                    enableScheduledEventDraining: 'false', //Experimental feature
                    podTerminationGracePeriod: '-1', //If negative, use value defined in pod
                    nodeTerminationGracePeriod: '120',
                    enablePrometheusServer: 'false', //For later use
                    emitKubernetesEvents: 'false' //For later use
                }
            },
            { ...opts, parent: args.cluster }
        )
    }
}
