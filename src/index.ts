import * as aws from '@pulumi/aws'
import * as awsx from '@pulumi/awsx'
import * as eks from '@pulumi/eks'
import * as k8s from '@pulumi/kubernetes'
import * as pulumi from '@pulumi/pulumi'

import * as externalDNS from './externalDNS'
import * as traefik from './traefik'
import * as nodeTerminationHandler from './nodeTerminationHandler'
import createCluster from './cluster'
import * as crds from './crds'
import * as autoscaler from './clusterAutoscaler'
import * as ebsCSI from './ebsCSI'
import * as ebsSnapshotController from './ebsSnapshotController'

export interface nodeGroups {
    /**
     * User specified node group name
     * This name will be used to create node labels for targeting workloads
     *
     * Node label format: 'nodeGroup':'<clusterName>-<nodeGroup.name>'
     *
     * https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/
     */
    name: string
    instanceTypes: aws.ec2.InstanceType[]
    /**
     *  Node group capacity type, valid values are `SPOT` and `ON_DEMAND` https://www.pulumi.com/registry/packages/eks/api-docs/managednodegroup/#capacitytype_nodejs
     */
    type: string
    /**
     * __default__: 1
     */
    minSize: number
    /**
     * __default__: 3
     */
    maxSize: number
    /**
     * __default__: 1
     * If cluster autoscaling is enabled modifying this value on an existing node group will have no impact
     */
    desired: number
}

export interface EKSClusterLauncherArgs {
    /** rootDomainName is the public dns name to configure external-dns and cert manager with */
    rootDomainName: string
    /**
    * nodeGroups is a list of EKS managed node groups that will be created
    * __default__: { name: 'default', type: 'SPOT', minSize: 1, maxSize: 3, desired: 1, instanceTypes: ['r5.large', 'r5a.large', 'r5b.large', 'r5n.large']} 
    * This name will be used to create node labels for targeting workloads
    * Node label format: 'nodeGroup':'<clusterName>-<nodeGroup.name>'
    *
    * https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/
    */
    nodeGroups: nodeGroups[]
    /** autoscaling configures min and maximum number of instances to run per AZ
     *
     * __default__: false
     */
    autoscaling?: boolean
    /** enableSnapshotController enables deployment of an ebs snapshot controller for automated snapshotting
     *
     * __default__: false
     */
    enableSnapshotController?: boolean
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
        autoscaling?: {
            enabled: boolean,
            memoryThreshold?: number
            cpuThreshold?: number
            minReplicas: number
            maxReplicas: number
        }
    }
    /**
     * volumeSize is size of an eks worker node ebs volume in gigabytes
     *
     * __default__: 20
     */
    volumeSize?: number
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

        const defaults: DeepRequired<Omit<EKSClusterLauncherArgs, 'rootDomainName' | 'email' | 'nodeGroups'>> = {
            allAZs: false,
            profile: 'default',
            region: 'us-east-1',
            cidrBlock: '10.0.0.0/16',
            autoscaling: false,
            enableSnapshotController: false,
            traefik: {
                whitelist: [],
                replicas: 3,
                resources: {
                    cpu: '300m',
                    memory: '256Mi'
                },
                autoscaling: {
                    enabled: false,
                    memoryThreshold: 50,
                    cpuThreshold: 80,
                    minReplicas: 1,
                    maxReplicas: 5
                }
            },
            volumeSize: 20
        }

        const argsWithDefaults: DeepRequired<Omit<EKSClusterLauncherArgs, 'email'>> & { email: string | undefined } = {
            nodeGroups: args.nodeGroups,
            rootDomainName: args.rootDomainName,
            allAZs: args.allAZs ?? defaults.allAZs,
            profile: args.profile ?? defaults.profile,
            region: args.region ?? defaults.region,
            cidrBlock: args.cidrBlock ?? defaults.cidrBlock,
            autoscaling: args.autoscaling ?? defaults.autoscaling,
            enableSnapshotController: args.enableSnapshotController ?? defaults.enableSnapshotController,
            email: args.email,
            traefik: {
                whitelist: args.traefik?.whitelist ?? defaults.traefik.whitelist,
                replicas: args.traefik?.replicas ?? defaults.traefik.replicas,
                autoscaling: {
                    enabled: args.traefik?.autoscaling?.enabled ?? defaults.traefik.autoscaling.enabled,
                    cpuThreshold: args.traefik?.autoscaling?.cpuThreshold ?? defaults.traefik.autoscaling.cpuThreshold,
                    memoryThreshold: args.traefik?.autoscaling?.memoryThreshold ?? defaults.traefik.autoscaling.memoryThreshold,
                    minReplicas: args.traefik?.autoscaling?.minReplicas ?? defaults.traefik.autoscaling.minReplicas,
                    maxReplicas: args.traefik?.autoscaling?.maxReplicas ?? defaults.traefik.autoscaling.maxReplicas,
                },
                resources: args.traefik?.resources ?? defaults.traefik.resources
            },
            volumeSize: args.volumeSize ?? defaults.volumeSize
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
                numberOfAvailabilityZones: argsWithDefaults.allAZs ? 3 : 2,
                tags: { Name: name, iac: `pulumi-${name}` }
            },
            { provider: awsProvider }
        )

        const { cluster } = createCluster(
            name,
            {
                vpc,
                clusterAutoscaler: argsWithDefaults.autoscaling,
                nodeGroups: argsWithDefaults.nodeGroups,
                volumeSize: argsWithDefaults.volumeSize,
            },
            { ...opts, provider: awsProvider }
        )

        const k8sProvider = new k8s.Provider(name, { kubeconfig: cluster.kubeconfigJson }, { dependsOn: [cluster] })

        // create a namespace for everything infra related
        const infraNamespace = new k8s.core.v1.Namespace(
            namespace,
            { metadata: { name: namespace } },
            { ...opts, provider: k8sProvider }
        )

        // deploy crds (cert manager and metrics-server) before traefik and external dns
        crds.deploy(
            namespace,
            argsWithDefaults.rootDomainName,
            argsWithDefaults.region,
            argsWithDefaults.email,
            { ...opts, provider: k8sProvider }
        )

        new traefik.Deployment(
            name,
            {
                namespace,
                replicas: argsWithDefaults.traefik.replicas,
                resources: argsWithDefaults.traefik.resources,
                whitelist: argsWithDefaults.traefik.whitelist,
                privateCidr: argsWithDefaults.cidrBlock,
                autoscaling: argsWithDefaults.traefik.autoscaling
            },
            { ...opts, provider: k8sProvider }
        )

        // assumes you have set up route53 and argsured your domain registrar with the appropriate ns records
        const zone = await aws.route53.getZone(
            { name: argsWithDefaults.rootDomainName },
            { ...opts, provider: awsProvider }
        )

        new nodeTerminationHandler.Deployment(
            name,
            {
                cluster: cluster,
                namespace: namespace
            },
            { ...opts, provider: k8sProvider }
        )

        new externalDNS.Deployment(
            name,
            {
                cluster: cluster,
                namespace,
                zone: zone as unknown as aws.route53.Zone,
                providers: { aws: awsProvider, k8s: k8sProvider }
            },
            opts
        )

        new ebsCSI.Deployment(
            name,
            {
                cluster: cluster,
                namespace,
                providers: { aws: awsProvider, k8s: k8sProvider }
            },
            opts
        )

        if (argsWithDefaults.enableSnapshotController) {
            new ebsSnapshotController.Deployment(
                name,
                {
                    cluster: cluster,
                    namespace,
                    providers: { aws: awsProvider, k8s: k8sProvider }
                },
                opts
            )
        }

        if (argsWithDefaults.autoscaling) {
            new autoscaler.Deployment(
                name,
                {
                    cluster: cluster,
                    namespace: namespace,
                    providers: { aws: awsProvider, k8s: k8sProvider }
                },
                opts
            )
        }

        const eksCluster = new EKSClusterLauncher(name, argsWithDefaults, opts)

        eksCluster.kubeconfig = cluster.kubeconfigJson
        eksCluster.cluster = cluster
        eksCluster.providers = {
            aws: awsProvider,
            k8s: k8sProvider
        }
        eksCluster.namespace = infraNamespace

        return eksCluster
    }
}
