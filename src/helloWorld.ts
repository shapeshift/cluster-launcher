import * as k8s from '@pulumi/kubernetes'
import * as kx from '@pulumi/kubernetesx'
import * as pulumi from '@pulumi/pulumi'

export interface DeployArgs {
    rootDomainName: string
}

export class Deployment extends kx.Deployment {
    readonly host: string

    constructor(name: string, args: DeployArgs, opts: pulumi.CustomResourceOptions) {
        const pb = new kx.PodBuilder({
            containers: [
                {
                    image: 'crccheck/hello-world:latest',
                    ports: [{ name: 'http', containerPort: 8000 }]
                }
            ]
        })

        super(name, { spec: pb.asDeploymentSpec() }, opts)

        this.host = `${name}.${args.rootDomainName}`

        const service = this.createService({
            type: kx.types.ServiceType.ClusterIP,
            ports: [{ name: 'http', port: 8000, targetPort: 8000 }]
        })

        // create certificate for them to use
        new k8s.apiextensions.CustomResource(
            name,
            {
                apiVersion: 'cert-manager.io/v1',
                kind: 'Certificate',
                metadata: {
                    namespace: 'default',
                    name: `${name}-cert`
                },
                spec: {
                    secretName: `${name}-cert`,
                    duration: '2160h',
                    renewBefore: '360h',
                    isCA: false,
                    privateKey: {
                        algorithm: 'RSA',
                        encoding: 'PKCS1',
                        size: 2048
                    },
                    dnsNames: [this.host],
                    issuerRef: {
                        name: 'lets-encrypt',
                        kind: 'ClusterIssuer',
                        group: 'cert-manager.io'
                    }
                }
            },
            { parent: service }
        )

        new k8s.apiextensions.CustomResource(
            name,
            {
                apiVersion: 'traefik.containo.us/v1alpha1',
                kind: 'IngressRoute',
                metadata: {
                    name: name,
                    namespace: this.metadata.namespace
                },
                spec: {
                    entryPoints: ['web', 'websecure'],
                    routes: [
                        {
                            match: `Host(\`${this.host}\`)`,
                            kind: 'Rule',
                            services: [
                                {
                                    kind: 'Service',
                                    name: service.metadata.name,
                                    port: service.spec.ports[0].targetPort,
                                    namespace: service.metadata.namespace
                                }
                            ]
                        }
                    ],
                    tls: {
                        secretName: `${name}-cert`,
                        domains: [{ main: this.host }]
                    }
                }
            },
            { parent: service, deleteBeforeReplace: true }
        )

        new k8s.networking.v1.Ingress(
            name,
            {
                metadata: { namespace: this.metadata.namespace },
                spec: { rules: [{ host: this.host }] }
            },
            { parent: service }
        )
    }
}
