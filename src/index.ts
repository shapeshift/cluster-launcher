import * as aws from '@pulumi/aws'
import * as awsx from '@pulumi/awsx'
import * as eks from '@pulumi/eks'
import * as k8s from '@pulumi/kubernetes'
import * as pulumi from '@pulumi/pulumi'

import * as externalDNS from './externalDNS'
import * as helloWorld from './helloWorld'
import * as traefik from './traefik'
import createCluster from './cluster'
import { deployCertManager } from './crds'

export interface EKSClusterLauncherArgs {
    /** rootDomainName is the public dns name to configure external-dns and cert manager with */
    rootDomainName: string
    /** instanceTypes is a list of instance types for the kublets https://aws.amazon.com/ec2/spot/pricing/ */
    instanceTypes: aws.ec2.InstanceType[]
    /** allAzs if true, will deploy to all AZs in specified region. otherwise, deploys to 2 AZs which is the minimum required by EKS
     *
     * __default__: false
     */
    allAZs?: boolean
    /** profile is the local profile to use configured in ~/.aws/credentials file
     *
     * __default__: 'default'
     */
    profile?: string
    /** region is the region to deploy the stack to
     *
     * __default__: 'default'
     */
    region?: aws.Region
    /** cidrBlock is the private subnet cidrRange for the VPC
     *
     * __default__: '10.0.0.0/16'
     */
    cidrBlock?: string
    /** email is the email address to be associated with the ACME account. This field is optional, but it is strongly recommended to be set. It will be used to contact you in case of issues with your account or certificates, including expiry notification emails.
     *
     * __default__: undefined
     */
    email?: string

    /** traefik allows customization of the traefik ingress controller
     * 
     * __default__: defaults to allow All traffic into the cluster, with 3 replicas using 300m cpu and 256 Mi per replica
     */
    traefik?: {
        /** whitelist is a list of cidrs to allow ingress into the cluster
         * 
         * __default__: 0.0.0.0/0 (WARNING: allowing ALL traffic into the cluster)
         */
        whitelist?: string[]
        /** replicas is the number of traefik pods to run 
         * 
         *__default__: 3
        */
        replicas: number
        /** resources is used to specify how much memory and cpu to give traefik pods
         * 
         * __default__ : { cpu: '300m', memory: '256Mi' }
         */
        resources?: {
            cpu: string
            memory: string
        }

    }
}

export class EKSClusterLauncher extends pulumi.ComponentResource {
    kubeconfig?: pulumi.Output<string>
    cluster?: eks.Cluster
    providers?: { aws: aws.Provider, k8s: k8s.Provider }
    namespace?: k8s.core.v1.Namespace

    constructor(name: string, args: EKSClusterLauncherArgs, opts?: pulumi.ComponentResourceOptions) {
        super('EKSClusterLauncher', name, args, opts)
    }

    static async create(name: string, args: EKSClusterLauncherArgs, opts?: pulumi.ComponentResourceOptions) {
        const defaults: Omit<EKSClusterLauncherArgs, 'rootDomainName' | 'instanceTypes'> = {
            allAZs: false,
            profile: 'default',
            region: 'us-east-1',
            cidrBlock: '10.0.0.0/16',
            email: undefined,
            traefik: {
                whitelist: [],
                replicas: 3,
                resources: {
                    cpu: '300m',
                    memory: '256Mi'
                }
            },
        }

        args = Object.assign(defaults, args)

        const namespace = `${name}-infra`
        const awsProvider = new aws.Provider(name, { profile: args.profile, region: args.region })

        const vpc = new awsx.ec2.Vpc(
            name,
            {
                cidrBlock: args.cidrBlock,
                numberOfAvailabilityZones: args.allAZs ? 'all' : 2,
                tags: { Name: name, iac: `pulumi-${name}` }
            },
            { provider: awsProvider }
        )

        const { kubeconfig, cluster } = await createCluster(name, vpc, args.instanceTypes, {
            ...opts,
            provider: awsProvider
        })

        const k8sProvider = new k8s.Provider(name, { kubeconfig })

        // create a namespace for everything infra related
        const infraNamespace = new k8s.core.v1.Namespace(namespace, { metadata: { name: namespace } }, { provider: k8sProvider })

        // deploy cert manager before traefik and external dns
        deployCertManager(namespace, args.rootDomainName, args.region as aws.Region, k8sProvider, args.email)

        new traefik.Deployment(
            name,
            {
                namespace,
                replicas: args.traefik?.replicas as number,
                resources: args.traefik?.resources as { cpu: string, memory: string },
                whitelist: args.traefik?.whitelist as [],
                privateCidr: args.cidrBlock as string
            },
            { provider: k8sProvider }
        )

        // assumes you have set up route53 and argsured your domain registrar with the appropriate ns records
        const zone = await aws.route53.getZone({ name: args.rootDomainName }, { provider: awsProvider })

        new externalDNS.Deployment(
            name,
            { cluster, namespace, zone: zone as unknown as aws.route53.Zone, awsProvider },
            { provider: k8sProvider }
        )

        // test hello world deployment to verify cluster is working correctly (default namespace)
        const hw = new helloWorld.Deployment(
            'helloworld',
            { rootDomainName: args.rootDomainName },
            { provider: k8sProvider }
        )

        const eksCluster = new EKSClusterLauncher(name, args, opts)

        eksCluster.kubeconfig = kubeconfig
        eksCluster.cluster = cluster
        eksCluster.providers = {
            aws: awsProvider,
            k8s: k8sProvider
        }
        eksCluster.namespace = infraNamespace

        return eksCluster
    }
}
