import * as k8s from '@pulumi/kubernetes'
import * as pulumi from '@pulumi/pulumi'
import { certmanager } from './types/cert-manager'

export const deploy = (
    namespace: string,
    dnsZone: string,
    region: string,
    logging?: boolean,
    email?: string,
    opts?: pulumi.ComponentResourceOptions
) => {
    const certManager = new k8s.yaml.ConfigFile(
        'cert-manager',
        { file: `${__dirname}/cert-manager.yaml` },
        opts
    )

    new k8s.yaml.ConfigFile(
        'metrics-server',
        { file: `${__dirname}/metrics-server.yaml` },
        opts
    )

    if (logging) {
        new k8s.yaml.ConfigFile(
            'event-router',
            { file: `${__dirname}/event-router.yaml` },
            opts
        )
    }

    //Also Issuer for ACME using lets encrypt
    new certmanager.v1.ClusterIssuer(
        'lets-encrypt',
        {
            apiVersion: 'cert-manager.io/v1',
            kind: 'ClusterIssuer',
            metadata: {
                name: 'lets-encrypt',
                namespace: namespace
            },
            spec: {
                acme: {
                    email,
                    server: 'https://acme-v02.api.letsencrypt.org/directory',
                    privateKeySecretRef: {
                        name: 'letsencrypt'
                    },
                    solvers: [
                        {
                            dns01: { route53: { region } },
                            selector: { dnsZones: [dnsZone] }
                        }
                    ]
                }
            }
        },
        { ...opts, dependsOn: certManager, deleteBeforeReplace: true }
    )
}
