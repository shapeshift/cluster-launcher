// *** WARNING: this file was generated by crd2pulumi. ***
// *** Do not edit by hand unless you're certain you know what you are doing! ***

import * as pulumi from "@pulumi/pulumi";
import { input as inputs, output as outputs } from "../../types";
import * as utilities from "../../utilities";

import {ObjectMeta} from "../../meta/v1";

/**
 * An Issuer represents a certificate issuing authority which can be referenced as part of `issuerRef` fields. It is scoped to a single namespace and can therefore only be referenced by resources within the same namespace.
 */
export class Issuer extends pulumi.CustomResource {
    /**
     * Get an existing Issuer resource's state with the given name, ID, and optional extra
     * properties used to qualify the lookup.
     *
     * @param name The _unique_ name of the resulting resource.
     * @param id The _unique_ provider ID of the resource to lookup.
     * @param opts Optional settings to control the behavior of the CustomResource.
     */
    public static get(name: string, id: pulumi.Input<pulumi.ID>, opts?: pulumi.CustomResourceOptions): Issuer {
        return new Issuer(name, undefined as any, { ...opts, id: id });
    }

    /** @internal */
    public static readonly __pulumiType = 'kubernetes:cert-manager.io/v1alpha2:Issuer';

    /**
     * Returns true if the given object is an instance of Issuer.  This is designed to work even
     * when multiple copies of the Pulumi SDK have been loaded into the same process.
     */
    public static isInstance(obj: any): obj is Issuer {
        if (obj === undefined || obj === null) {
            return false;
        }
        return obj['__pulumiType'] === Issuer.__pulumiType;
    }

    public readonly apiVersion!: pulumi.Output<"cert-manager.io/v1alpha2" | undefined>;
    public readonly kind!: pulumi.Output<"Issuer" | undefined>;
    public readonly metadata!: pulumi.Output<ObjectMeta | undefined>;
    /**
     * Desired state of the Issuer resource.
     */
    public readonly spec!: pulumi.Output<outputs.certmanager.v1alpha2.IssuerSpec | undefined>;
    /**
     * Status of the Issuer. This is set and managed automatically.
     */
    public readonly status!: pulumi.Output<outputs.certmanager.v1alpha2.IssuerStatus | undefined>;

    /**
     * Create a Issuer resource with the given unique name, arguments, and options.
     *
     * @param name The _unique_ name of the resource.
     * @param args The arguments to use to populate this resource's properties.
     * @param opts A bag of options that control this resource's behavior.
     */
    constructor(name: string, args?: IssuerArgs, opts?: pulumi.CustomResourceOptions) {
        let inputs: pulumi.Inputs = {};
        opts = opts || {};
        if (!opts.id) {
            inputs["apiVersion"] = "cert-manager.io/v1alpha2";
            inputs["kind"] = "Issuer";
            inputs["metadata"] = args ? args.metadata : undefined;
            inputs["spec"] = args ? args.spec : undefined;
            inputs["status"] = args ? args.status : undefined;
        } else {
            inputs["apiVersion"] = undefined /*out*/;
            inputs["kind"] = undefined /*out*/;
            inputs["metadata"] = undefined /*out*/;
            inputs["spec"] = undefined /*out*/;
            inputs["status"] = undefined /*out*/;
        }
        if (!opts.version) {
            opts = pulumi.mergeOptions(opts, { version: utilities.getVersion()});
        }
        super(Issuer.__pulumiType, name, inputs, opts);
    }
}

/**
 * The set of arguments for constructing a Issuer resource.
 */
export interface IssuerArgs {
    readonly apiVersion?: pulumi.Input<"cert-manager.io/v1alpha2">;
    readonly kind?: pulumi.Input<"Issuer">;
    readonly metadata?: pulumi.Input<ObjectMeta>;
    /**
     * Desired state of the Issuer resource.
     */
    readonly spec?: pulumi.Input<inputs.certmanager.v1alpha2.IssuerSpecArgs>;
    /**
     * Status of the Issuer. This is set and managed automatically.
     */
    readonly status?: pulumi.Input<inputs.certmanager.v1alpha2.IssuerStatusArgs>;
}
