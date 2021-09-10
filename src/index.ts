import * as aws from '@pulumi/aws'
import * as awsx from '@pulumi/awsx'
import * as eks from '@pulumi/eks'
import * as k8s from '@pulumi/kubernetes'
import * as pulumi from '@pulumi/pulumi'

import * as externalDNS from './externalDNS'
import * as helloWorld from './helloWorld'
import * as traefik from './traefik'
import createCluster from './cluster'
import * as crds from './crds'
import * as autoscaler from './clusterAutoscaler'

export interface EKSClusterLauncherArgs {
    /** rootDomainName is the public dns name to configure external-dns and cert manager with */
    rootDomainName: string
    /** instanceTypes is a list of instance types for the kublets https://aws.amazon.com/ec2/spot/pricing/ */
    instanceTypes: aws.ec2.InstanceType[]
    /** numInstancesPerAZ specify the desired number of instances you want per AZ, if using a cluster-autoscaler this is irrelevant*/
    numInstancesPerAZ?: number
    /** autoscaling configures min and maximum number of instances to run per AZ
     *
     * __default__: { minInstances: 1, maxInstances: 3 }
     */
    autoscaling?: {
        enabled: boolean
        minInstances: number
        maxInstances: number
    }
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
        replicas?: number
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
    providers?: { aws: aws.Provider; k8s: k8s.Provider }
    namespace?: k8s.core.v1.Namespace

    constructor(name: string, args: EKSClusterLauncherArgs, opts?: pulumi.ComponentResourceOptions) {
        super('EKSClusterLauncher', name, args, opts)
    }

    static async create(name: string, args: EKSClusterLauncherArgs, opts?: pulumi.ComponentResourceOptions) {
        type DeepRequired<T> = {
            [P in keyof T]-?: DeepRequired<T[P]>
        }

        const defaults: DeepRequired<Omit<EKSClusterLauncherArgs, 'rootDomainName' | 'instanceTypes' | 'email'>> = {
            allAZs: false,
            profile: 'default',
            region: 'us-east-1',
            cidrBlock: '10.0.0.0/16',
            numInstancesPerAZ: 1,
            autoscaling: {
                enabled: false,
                maxInstances: 3,
                minInstances: 1
            },
            traefik: {
                whitelist: [],
                replicas: 3,
                resources: {
                    cpu: '300m',
                    memory: '256Mi'
                }
            }
        }

        const argsWithDefaults: DeepRequired<Omit<EKSClusterLauncherArgs, 'email'>> & { email: string | undefined } = {
            instanceTypes: args.instanceTypes,
            rootDomainName: args.rootDomainName,
            allAZs: args.allAZs ?? defaults.allAZs,
            profile: args.profile ?? defaults.profile,
            region: args.region ?? defaults.region,
            cidrBlock: args.cidrBlock ?? defaults.cidrBlock,
            numInstancesPerAZ: args.numInstancesPerAZ ?? defaults.numInstancesPerAZ,
            autoscaling: {
                enabled: args.autoscaling?.enabled ?? defaults.autoscaling.enabled,
                maxInstances: args.autoscaling?.maxInstances ?? defaults.autoscaling.maxInstances,
                minInstances: args.autoscaling?.minInstances ?? defaults.autoscaling.minInstances
            },
            email: args.email,
            traefik: {
                whitelist: args.traefik?.whitelist ?? defaults.traefik.whitelist,
                replicas: args.traefik?.replicas ?? defaults.traefik.replicas,
                resources: args.traefik?.resources ?? defaults.traefik.resources
            }
        }

        const namespace = `${name}-infra`
        const awsProvider = new aws.Provider(
            name,
            {
                profile: argsWithDefaults.profile,
                region: argsWithDefaults.region
            },
            opts
        )

        const vpc = new awsx.ec2.Vpc(
            name,
            {
                cidrBlock: argsWithDefaults.cidrBlock,
                numberOfAvailabilityZones: argsWithDefaults.allAZs ? 'all' : 2,
                tags: { Name: name, iac: `pulumi-${name}` }
            },
            { provider: awsProvider }
        )

        const { kubeconfig, cluster } = await createCluster(
            name,
            {
                autoscaling: argsWithDefaults.autoscaling,
                vpc,
                enabledClusterAutoscaler: argsWithDefaults.autoscaling.enabled,
                instanceTypes: argsWithDefaults.instanceTypes,
                numberOfInstancesPerAz: argsWithDefaults.numInstancesPerAZ
            },
            {
                ...opts,
                provider: awsProvider
            }
        )

        const k8sProvider = new k8s.Provider(name, { kubeconfig }, { dependsOn: [cluster] })

        // create a namespace for everything infra related
        const infraNamespace = new k8s.core.v1.Namespace(
            namespace,
            { metadata: { name: namespace } },
            { ...opts, provider: k8sProvider }
        )

        // deploy cert manager before traefik and external dns
        // also deploy metric-server
        crds.deploy(namespace, argsWithDefaults.rootDomainName, argsWithDefaults.region, argsWithDefaults.email, {
            ...opts,
            provider: k8sProvider
        })

        new traefik.Deployment(
            name,
            {
                namespace,
                replicas: argsWithDefaults.traefik.replicas,
                resources: argsWithDefaults.traefik.resources,
                whitelist: argsWithDefaults.traefik.whitelist,
                privateCidr: argsWithDefaults.cidrBlock
            },
            { ...opts, provider: k8sProvider }
        )

        // assumes you have set up route53 and argsured your domain registrar with the appropriate ns records
        const zone = await aws.route53.getZone(
            { name: argsWithDefaults.rootDomainName },
            { ...opts, provider: awsProvider }
        )

        new externalDNS.Deployment(
            name,
            { cluster, namespace, zone: zone as unknown as aws.route53.Zone, awsProvider },
            { ...opts, provider: k8sProvider }
        )

        if (argsWithDefaults.autoscaling.enabled)
            new autoscaler.Deployment(
                name,
                {
                    cluster: cluster,
                    namespace: namespace,
                    providers: { aws: awsProvider, k8s: k8sProvider }
                },
                opts
            )

        // test hello world deployment to verify cluster is working correctly (default namespace)
        const hw = new helloWorld.Deployment(
            'helloworld',
            { rootDomainName: argsWithDefaults.rootDomainName },
            { ...opts, provider: k8sProvider }
        )

        const eksCluster = new EKSClusterLauncher(name, argsWithDefaults, opts)

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
