import * as k8s from '@pulumi/kubernetes'
import * as pulumi from '@pulumi/pulumi'
import { Cluster } from '@pulumi/eks'

export interface deploymentArgs {
    namespace: pulumi.Input<string>
    cluster: Cluster
    resources: { cpu: string; memory: string }
    logging?: boolean
    metrics?: boolean
}

export class Deployment extends k8s.helm.v3.Chart {
    constructor(name: string, args: deploymentArgs, opts?: pulumi.ComponentResourceOptions) {
        const datasources = []
        if (args.logging) {
            datasources.push({
                name: 'Loki',
                type: 'loki',
                url: `http://${name}-loki:3100`,
                access: 'proxy'
            })
        }
        if (args.metrics) {
            datasources.push({
                name: 'Prometheus',
                type: 'prometheus',
                url: `http://${name}-prometheus-server:80`,
                access: 'proxy'
            })
        }

        super(
            `${name}-grafana`,
            {
                // https://github.com/grafana/helm-charts/tree/main/charts/grafana
                chart: 'grafana',
                repo: 'grafana',
                namespace: args.namespace,
                version: '6.17.2',
                values: {
                    datasources: {
                        'datasources.yaml': {
                            apiVersion: 1,
                            datasources: datasources
                        }
                    }
                }
            },
            { ...opts, parent: args.cluster }
        )
    }
}
