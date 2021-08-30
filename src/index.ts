import * as aws from '@pulumi/aws'
import * as k8s from '@pulumi/kubernetes'
import * as awsx from '@pulumi/awsx'
import * as pulumi from '@pulumi/pulumi'

import createCluster from './cluster'
import * as helloWorld from './helloWorld'
import * as traefik from './traefik'
import * as externalDNS from './externalDNS'
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
    /**
     * List of cidrs to allow ingress into the cluster
     * If this is empty 0.0.0.0/0 is used allow ALL traffic into the cluster
     */
    whitelist?: string[]
}

export class EKSClusterLauncher extends pulumi.ComponentResource {
    kubeconfig?: pulumi.Output<string>

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
            whitelist: []
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
        new k8s.core.v1.Namespace(namespace, { metadata: { name: namespace } }, { provider: k8sProvider })

        // deploy cert manager before traefik and external dns
        deployCertManager(namespace, args.rootDomainName, args.region as aws.Region, k8sProvider, args.email)

        new traefik.Deployment(
            name,
            {
                namespace,
                resources: { cpu: '300m', memory: '256Mi' },
                whitelist: args.whitelist as string[],
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

        return eksCluster
    }
}
