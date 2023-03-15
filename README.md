# Cluster launcher

The cluster launcher is a pulumi package used to create an eks cluster. This is currently being used to deploy **[unchained's cluster](https://github.com/shapeshift/unchained)**. Eventually it could include other cloud kubernetes providers like GKE, AKS, etc ...

## Dependencies

-   [pulumi](https://www.pulumi.com/docs/index.html)
-   [helm3](https://helm.sh/)

### Helm setup

The following charts must be added to your repo list:

```
helm repo add traefik https://traefik.github.io/charts
helm repo add aws-ebs-csi-driver https://kubernetes-sigs.github.io/aws-ebs-csi-driver
helm repo add piraeus-charts https://piraeus.io/helm-charts/
helm repo add bitnami https://charts.bitnami.com/bitnami
helm repo add eks https://aws.github.io/eks-charts/
helm repo update

```

## Installing

To use from javascript or Typescript in Node.js install using either:

`npm`:

    $ npm install @shapeshiftoss/cluster-launcher

or `yarn`:

    $ yarn add @shapeshiftoss/cluster-launcher

## Example Usage

### Configure Route53 / DNS Registrar

In order for `external-dns` and `cert-manager` to opperated correctly. rootDnsName must be created in route53 manually and NS servers must be updated on registrar

1. Go to [route53 in AWS console](https://console.aws.amazon.com/route53/v2/home#Dashboard)
2. Create a new `Hosted Zone` by clicking `Create hosted zone`
3. Enter your `Domain Name` that you own and plan on using for this EKS cluster. Leave it public and save.
4. Copy the name servers found in the `NS` record it should be 4 values looking something like:
    ```
    ns-1570.awsdns-04.co.uk.
    ns-810.awsdns-37.net.
    ns-265.awsdns-33.com.
    ns-1050.awsdns-03.org.
    ```
5. Update / Change nameservers wherever your domain is currently setup.
    - [Example for Godaddy](https://ph.godaddy.com/help/change-nameservers-for-my-domains-664)

### Configure AWS CLI credentials

1. If you do not have a `aws_access_key_id` and `aws_secret_access_key` create one for your user on [IAM](https://console.aws.amazon.com/iamv2/home?#/users)

    - Select your user --> Security credentials --> create Access Key

2. If you do not have a credentials file found `~/.aws/credentials` create one.
    ```shell
    $ touch ~/.aws/credentials
    ```
3. If you haven't setup a profile before just setup a default copying the credentials you created
    ```shell
    $ cat <<EOT >> ~/.aws/credentials
    [default]
    aws_access_key_id = <Your Access Key ID>
    aws_secret_access_key = <Your Secret Access Key>
    EOT
    ```

    if you have simply create a new profile whatever you want to name it inside `[]`. You will need to specify profile in the `EKSClusterLauncherArgs` otherwise it will use `default`
    ```shell
    $ cat <<EOT >> ~/.aws/credentials
    [New-Profile-Name]
    aws_access_key_id = <Access-Key-ID>
    aws_secret_access_key = <Secret-Access-Key>
    EOT
    ```


Now you are ready to use the `EKSClusterLauncher`

```typescript
import { EKSClusterLauncher } from '@shapeshiftoss/cluster-launcher'

const cluster = await EKSClusterLauncher.create(app, {
    rootDomainName: 'example.com', // Domain configured in Route53
    instanceTypes: ['t3.small', 't3.medium', 't3.large'] // List of instances to be used for worker nodes
})

const kubeconfig = cluster.kubeconfig

const k8sProvider = new Provider('kube-provider', { kubeconfig })
```

---

## Deployed resources

This package deploys everything nessesary for an opperational eks cluster including:

-   VPC (subnets, route tables, NAT, Internet Gateway)
-   EKS Cluster (Master Node)
-   Managed Node group per AZ (Worker Nodes)
-   Namespace in cluster for all of the additional services `<name>-infra`
-   Additional Services:
    -   Cert Manager configured for lets encrypt
    -   Traefik as Ingress Controller
    -   External DNS for dynamic configuration of route53 records from Ingress objects
    -   AWS Node Termination Handler to ensure we can gracefully stop services if SPOT instances are preempted 
    -   A simple Hello World app at `helloworld.<rootDomainName>` to see that all components are working correctly
    -   A PLG (Promtail, Loki, Grafana) stack for log aggregation is available but not deployed by default

## Access Grafana

A very basic PLG stack can be implemented to aid in troubleshooting, this is how you can access Grafana from outside your cluster.

_Replace `<templated variables>` with variables specific to your deployment_

1. In the namespace where grafana is hosted get the admin password
`kubectl get secret <grafana secret> -o jsonpath="{.data.admin-password}" | base64 --decode ; echo`

2. Forward grafana port to local machine
`kubectl port-forward service/<grafana service> 8080:80`

3. On your local machine, navigate to `localhost:8080`
`admin / <password retrieved during step 1>`

## Additional Notes

-   traefik dashboard is accessible through port forwarding at path `/dashboard/#`
-   we are currently using instance role for route53, but this can be dangerous because ALL pods in cluster will be allowed to modify route53. Be careful with what workloads are running in this cluster. [more information](https://github.com/kubernetes-sigs/external-dns/blob/master/docs/tutorials/aws.md#ec2-instance-role-not-recommended)
-   If using persistent volumes in the Loki stack you'll want to ensure EBS volumes are cleaned up if logging is disabled.  Default behavior is that persistent volume claims are not deleted when it's parent StatefulSet is deleted. Functionality to cleanup a PVC when a StatefulSet is removed is slated for release in [Kubernetes v1.23](https://github.com/kubernetes/enhancements/tree/master/keps/sig-apps/1847-autoremove-statefulset-pvcs)
