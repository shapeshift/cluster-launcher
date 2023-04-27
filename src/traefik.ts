import * as k8s from '@pulumi/kubernetes'
import * as pulumi from '@pulumi/pulumi'

export interface ingressControllerArgs {
    namespace: pulumi.Input<string>
    resources: { cpu: string; memory: string }
    privateCidr: string
    replicas: number,
    autoscaling: {
        enabled: boolean,
        memoryThreshold: number
        cpuThreshold: number
        minReplicas: number
        maxReplicas: number
    }
    /**
     * List of cidrs to allow ingress into the cluster
     * If this is empty 0.0.0.0/0 is used allow ALL traffic into the cluster
     */
    whitelist: string[]
}

// Requires cert manager to be present beforehand
export class Deployment extends k8s.helm.v3.Chart {
    constructor(name: string, args: ingressControllerArgs, opts: pulumi.ComponentResourceOptions) {
        const annotations: { [key: string]: pulumi.Output<string> | string } = {
            'service.beta.kubernetes.io/aws-load-balancer-backend-protocol': 'http',
            'service.beta.kubernetes.io/aws-load-balancer-connection-idle-timeout': '30',
            // This is for layer 4. It will forward ip through to traefik. THIS DOESN'T SUPPORT SECURITY GROUPS
            'service.beta.kubernetes.io/aws-load-balancer-type': 'nlb'
        }

        name = `${name}-traefik`

        super(
            name,
            {
                chart: 'traefik',
                repo: 'traefik',
                namespace: args.namespace,
                version: '20.8.0',
                values: {
                    providers: {
                        kubernetesIngress: {
                            // need this so that the Ingress will have "ADDRESS" set from service. External-DNS needs the address
                            publishedService: {
                                enabled: true
                            }
                        }
                    },
                    ports: {
                        // TODO secure traefik ingress recommended https://github.com/traefik/traefik-helm-chart/blob/master/traefik/values.yaml#L205
                        web: {
                            redirectTo: 'websecure'
                        }
                    },
                    logs: {
                        general: {
                            level: 'ERROR',
                            format: 'json'
                        },
                        access: {
                            enabled: true,
                            format: 'json',
                            fields: {
                                headers: {
                                    defaultmode: 'keep',
                                    names: {
                                        Authorization: 'redact'
                                    }
                                }
                            }
                        }
                    },
                    resources: {
                        limits: args.resources,
                        requests: args.resources
                    },
                    // TODO potentially secure further with middlewares. Currently the API is exposed to anyone in sourceRange (VPN, NATs)
                    additionalArguments: [
                        '--api.dashboard',
                        '--entrypoints.web.http.redirections.entryPoint.permanent=true',
                        '--metrics.datadog.address=datadog-statsd:8125',
                        `--entryPoints.web.forwardedHeaders.trustedIPs=${args.privateCidr}`,
                        `--entryPoints.web.proxyProtocol.trustedIPs=${args.privateCidr}`,
                        '--entryPoints.web.transport.respondingTimeouts.readTimeout=30s',
                        '--entryPoints.web.transport.respondingTimeouts.writeTimeout=30s',
                        '--entryPoints.web.transport.respondingTimeouts.idleTimeout=30s',
                        `--entryPoints.websecure.forwardedHeaders.trustedIPs=${args.privateCidr}`,
                        `--entryPoints.websecure.proxyProtocol.trustedIPs=${args.privateCidr}`,
                        '--entryPoints.websecure.transport.respondingTimeouts.readTimeout=30s',
                        '--entryPoints.websecure.transport.respondingTimeouts.writeTimeout=30s',
                        '--entryPoints.websecure.transport.respondingTimeouts.idleTimeout=30s'
                        //pulumi.interpolate`--entryPoints.websecure.http.middlewares=${args.namespace}-${authHttpsHeader.metadata.name}@kubernetescrd`
                    ],
                    globalArguments: [], // git rid of sendanonymoususage
                    service: {
                        loadBalancerSourceRanges: args.whitelist,
                        annotations
                    },
                    ingressRoute: {
                        dashboard: {
                            enabled: false // disable dashboard deploy via helmchart. uses Hooks which aren't supported by pulumi. https://github.com/pulumi/pulumi-kubernetes/issues/555
                        }
                    },
                    affinity: {
                        podAntiAffinity: {
                            preferredDuringSchedulingIgnoredDuringExecution: [
                                {
                                    weight: 100,
                                    podAffinityTerm: {
                                        labelSelector: {
                                            matchExpressions: [
                                                {
                                                    key: 'app',
                                                    operator: 'In',
                                                    values: [name]
                                                }
                                            ]
                                        },
                                        topologyKey: 'failure-domain.beta.kubernetes.io/zone'
                                    }
                                }
                            ]
                        }
                    },
                    podDisruptionBudget: {
                        enabled: true,
                        minAvailable: 2
                    },
                    deployment: {
                        replicas: args.replicas,
                        podAnnotations: {
                            'prometheus.io/port': '9100',
                            'prometheus.io/scrape': 'true'
                        }
                    }
                },
                transformations: [
                    // This is because the service publishes to the default namespace even when specifying namespace on helm chart
                    (manifest: any) => {
                        if (manifest.kind === 'Service') manifest.metadata['namespace'] = args.namespace
                    }
                ]
            },
            opts
        )

        if (args.autoscaling.enabled) {
            new k8s.autoscaling.v2.HorizontalPodAutoscaler(
                name,
                {
                    metadata: {
                        namespace: args.namespace,
                    },
                    spec: {
                        minReplicas: args.autoscaling.minReplicas,
                        maxReplicas: args.autoscaling.maxReplicas,
                        scaleTargetRef: {
                            apiVersion: 'apps/v1',
                            kind: 'Deployment',
                            name: name,
                        },
                        metrics: [
                            {
                                type: 'Resource',
                                resource: {
                                    name: 'cpu',
                                    target: {
                                        type: 'Utilization',
                                        averageUtilization: args.autoscaling.cpuThreshold
                                    }
                                }
                            },
                            {
                                type: 'Resource',
                                resource: {
                                    name: 'memory',
                                    target: {
                                        type: 'Utilization',
                                        averageUtilization: args.autoscaling.memoryThreshold
                                    }
                                }
                            }
                        ]
                    },
                },
                { ...opts, dependsOn: this.ready, parent: this }
            )
        }

        //TODO seems like we need `/dashboard/#/ in order to see dashboard. fix / answer why this is
        new k8s.apiextensions.CustomResource(
            'traefik-dashboard',
            {
                apiVersion: 'traefik.containo.us/v1alpha1',
                kind: 'IngressRoute',
                metadata: {
                    name: 'dashboard',
                    namespace: args.namespace
                },
                spec: {
                    entryPoints: ['traefik'],
                    routes: [
                        {
                            match: '(PathPrefix(`/dashboard`) || PathPrefix(`/api`))',
                            kind: 'Rule',
                            services: [
                                {
                                    name: 'api@internal',
                                    kind: 'TraefikService'
                                }
                            ]
                        }
                    ]
                }
            },
            { ...opts, dependsOn: this.ready, parent: this }
        )
    }
}
