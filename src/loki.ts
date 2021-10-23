import * as k8s from '@pulumi/kubernetes'
import * as pulumi from '@pulumi/pulumi'
import { Cluster } from '@pulumi/eks'

export interface deploymentArgs {
    namespace: pulumi.Input<string>
    cluster: Cluster
}

export class Deployment extends pulumi.ComponentResource {
    constructor(name: string, args: deploymentArgs, opts?: pulumi.ComponentResourceOptions) {
        super('loki', name, {}, opts)
        new k8s.helm.v3.Chart(
            `${name}-loki`,
            {
                // https://github.com/grafana/helm-charts/tree/main/charts/loki
                chart: 'loki',
                repo: 'grafana',
                namespace: args.namespace,
                version: '2.6.0',
                values: {
                    persistence: {
                        enabled: true,
                        accessModes: ['ReadWriteOnce'],
                        size: '10Gi'
                    },
                    limits_config: {
                        retention_period: '336h'
                    }
                }
            },
            { ...opts, parent: args.cluster }
        )

        const extraScrapeConfigs = `
- job_name: journal
  journal:
    path: /var/log/journal
    max_age: 12h
    labels:
      job: systemd-journal
  relabel_configs:
      - source_labels: ['__journal__systemd_unit']
        target_label: 'unit'
      - source_labels: ['__journal__hostname']
        target_label: 'hostname'
`
        new k8s.helm.v3.Chart(`${name}-promtail`, {
            // https://github.com/grafana/helm-charts/tree/main/charts/promtail
            chart: 'promtail',
            repo: 'grafana',
            namespace: args.namespace,
            version: '3.8.2',
            values: {
                config: {
                    lokiAddress: `http://${name}-loki:3100/loki/api/v1/push`,
                    snippets: {
                        extraScrapeConfigs: extraScrapeConfigs,
                        pipelineStages: [
                            {
                                docker: {},
                            },
                            {
                                match: {
                                    selector: '{app="eventrouter"}',
                                    stages: [
                                        {
                                            json: {
                                                expressions: {
                                                    namespace: 'event.metadata.namespace'
                                                }
                                            }
                                        },
                                        {
                                            labels:{
                                                namespace: ""
                                            }
                                        }
                                    ]
                                }
                            }
                        ]
                    }
                },
                extraVolumes: [
                    {
                        name: 'journal',
                        hostPath: {
                            path: '/var/log/journal'
                        }
                    }
                ],
                extraVolumeMounts: [
                    {
                        name: 'journal',
                        mountPath: '/var/log/journal',
                        readOnly: true
                    }
                ]
            }
        })
    }
}
