import * as k8s from '@pulumi/kubernetes'
import * as pulumi from '@pulumi/pulumi'
import { Cluster } from '@pulumi/eks'

export interface deploymentArgs {
    namespace: pulumi.Input<string>
    cluster: Cluster
    persistentVolume: boolean
    pvSize: string
    retentionPeriod: string
    resources: {
        loki: {
            cpu: string
            memory: string
        }
        promtail: {
            cpu: string
            memory: string
        }
    }
}

export class Deployment extends pulumi.ComponentResource {
    constructor(name: string, args: deploymentArgs, opts?: pulumi.ComponentResourceOptions) {
        super('loki', name, {}, opts)

        const compactionConfig = args.persistentVolume
            ? {
                  compaction_interval: '10m',
                  retention_enabled: true,
                  retention_delete_delay: '2h',
                  retention_delete_worker_count: 150
              }
            : {}

        const limitsConfig = args.persistentVolume
            ? {
                  retention_period: args.retentionPeriod
              }
            : {}

        new k8s.helm.v3.Chart(
            `${name}-loki`,
            {
                // https://github.com/grafana/helm-charts/tree/main/charts/loki
                chart: 'loki',
                repo: 'grafana',
                namespace: args.namespace,
                version: '2.6.0',
                values: {
                    config: {
                        compactor: compactionConfig,
                        limits_config: limitsConfig
                    },
                    persistence: {
                        enabled: args.persistentVolume,
                        size: args.pvSize
                    },
                    resources: {
                        limits: {
                            cpu: args.resources.loki.cpu,
                            memory: args.resources.loki.memory
                        },
                        requests: {
                            cpu: args.resources.loki.cpu,
                            memory: args.resources.loki.memory
                        }
                    },
                    // Work around ro-filesystem issue (https://github.com/grafana/helm-charts/issues/609)
                    extraVolumes: [
                        {
                            name: 'temp',
                            emptyDir: {}
                        }
                    ],
                    extraVolumeMounts: [
                        {
                            name: 'temp',
                            mountPath: '/tmp'
                        }
                    ]
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
        new k8s.helm.v3.Chart(
            `${name}-promtail`,
            {
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
                                    docker: {}
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
                                                labels: {
                                                    namespace: ''
                                                }
                                            }
                                        ]
                                    }
                                }
                            ]
                        }
                    },
                    resources: {
                        limits: {
                            cpu: args.resources.promtail.cpu,
                            memory: args.resources.promtail.memory
                        },
                        requests: {
                            cpu: args.resources.promtail.cpu,
                            memory: args.resources.promtail.memory
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
            },
            { ...opts, parent: args.cluster }
        )
    }
}
