import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

type AddonEntry = {
    id: string;
    label: string;
    extraPrice: string;
    isFree: boolean;
    sortOrder: string;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { admin } = await authenticate.admin(request);
    const response = await admin.graphql(
        `#graphql
    query ListAddons {
      metaobjects(type: "$app:signage_addon", first: 100) {
        edges { node { id fields { key value } } }
      }
    }`
    );
    const data = await response.json();
    const addons: AddonEntry[] = data.data.metaobjects.edges.map((edge: any) => {
        const f: Record<string, string> = {};
        edge.node.fields.forEach((x: any) => { f[x.key] = x.value; });
        return {
            id: edge.node.id,
            label: f.label || "",
            extraPrice: f.extra_price_decimal || "0",
            isFree: f.is_free === "true",
            sortOrder: f.sort_order || "0",
        };
    });
    addons.sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder));
    return { addons };
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const { admin } = await authenticate.admin(request);
    const formData = await request.formData();
    const intent = formData.get("intent");

    const fields = [
        { key: "label", value: String(formData.get("label") || "") },
        { key: "extra_price_decimal", value: String(formData.get("extraPrice") || "0") },
        { key: "is_free", value: formData.get("isFree") === "on" ? "true" : "false" },
        { key: "sort_order", value: String(formData.get("sortOrder") || "0") },
    ];

    if (intent === "create") {
        const response = await admin.graphql(
            `#graphql
      mutation CreateAddon($metaobject: MetaobjectCreateInput!) {
        metaobjectCreate(metaobject: $metaobject) {
          metaobject { id }
          userErrors { field message }
        }
      }`,
            { variables: { metaobject: { type: "$app:signage_addon", fields } } }
        );
        const data = await response.json();
        const errors = data.data?.metaobjectCreate?.userErrors;
        if (errors?.length) return { error: errors[0].message };
        return { success: true };
    }

    if (intent === "update") {
        const id = String(formData.get("id"));
        const response = await admin.graphql(
            `#graphql
      mutation UpdateAddon($id: ID!, $metaobject: MetaobjectUpdateInput!) {
        metaobjectUpdate(id: $id, metaobject: $metaobject) {
          metaobject { id }
          userErrors { field message }
        }
      }`,
            { variables: { id, metaobject: { fields } } }
        );
        const data = await response.json();
        const errors = data.data?.metaobjectUpdate?.userErrors;
        if (errors?.length) return { error: errors[0].message };
        return { success: true };
    }

    if (intent === "delete") {
        const id = String(formData.get("id"));
        const response = await admin.graphql(
            `#graphql
      mutation DeleteAddon($id: ID!) {
        metaobjectDelete(id: $id) { deletedId userErrors { field message } }
      }`,
            { variables: { id } }
        );
        const data = await response.json();
        const errors = data.data?.metaobjectDelete?.userErrors;
        if (errors?.length) return { error: errors[0].message };
        return { success: true };
    }

    return { error: "Unknown action" };
};

export default function AddonsPage() {
    const { addons } = useLoaderData<typeof loader>();
    const fetcher = useFetcher<typeof action>();
    const shopify = useAppBridge();
    const [editingId, setEditingId] = useState<string | null>(null);
    const isSubmitting = fetcher.state !== "idle";

    useEffect(() => {
        if (fetcher.data && "success" in fetcher.data && fetcher.data.success) {
            shopify.toast.show("Saved successfully");
            setEditingId(null);
        }
        if (fetcher.data && "error" in fetcher.data && fetcher.data.error) {
            shopify.toast.show(fetcher.data.error, { isError: true });
        }
    }, [fetcher.data, shopify]);

    return (
        <s-page heading="Signage Add-ons">
            <s-section heading="Add New Add-on">
                <s-link href="/app/neon-signs">← Back to Neon Signs</s-link>
                <fetcher.Form method="post">
                    <input type="hidden" name="intent" value="create" />
                    <s-stack direction="inline" gap="base">
                        <input type="text" name="label" placeholder="Label (e.g. Wall Mounting Kit)" required />
                        <input type="number" step="0.01" name="extraPrice" placeholder="Extra Price" defaultValue="0" />
                        <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
                            <input type="checkbox" name="isFree" /> Is Free
                        </label>
                        <input type="number" name="sortOrder" placeholder="Sort Order" defaultValue={addons.length + 1} />
                        <s-button type="submit" {...(isSubmitting ? { loading: true } : {})}>Add</s-button>
                    </s-stack>
                </fetcher.Form>
            </s-section>

            <s-section heading={`Existing Add-ons (${addons.length})`}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                        <tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
                            <th style={{ padding: "8px" }}>Label</th>
                            <th style={{ padding: "8px" }}>Extra Price</th>
                            <th style={{ padding: "8px" }}>Is Free</th>
                            <th style={{ padding: "8px" }}>Sort Order</th>
                            <th style={{ padding: "8px" }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {addons.map((a) => (
                            <tr key={a.id} style={{ borderBottom: "1px solid #eee" }}>
                                {editingId === a.id ? (
                                    <td colSpan={5} style={{ padding: "8px" }}>
                                        <fetcher.Form method="post">
                                            <input type="hidden" name="intent" value="update" />
                                            <input type="hidden" name="id" value={a.id} />
                                            <s-stack direction="inline" gap="base">
                                                <input type="text" name="label" defaultValue={a.label} required />
                                                <input type="number" step="0.01" name="extraPrice" defaultValue={a.extraPrice} />
                                                <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                                    <input type="checkbox" name="isFree" defaultChecked={a.isFree} /> Is Free
                                                </label>
                                                <input type="number" name="sortOrder" defaultValue={a.sortOrder} />
                                                <s-button type="submit" {...(isSubmitting ? { loading: true } : {})}>Save</s-button>
                                                <s-button variant="tertiary" onClick={() => setEditingId(null)}>Cancel</s-button>
                                            </s-stack>
                                        </fetcher.Form>
                                    </td>
                                ) : (
                                    <>
                                        <td style={{ padding: "8px" }}>{a.label}</td>
                                        <td style={{ padding: "8px" }}>${a.extraPrice}</td>
                                        <td style={{ padding: "8px" }}>{a.isFree ? "Yes" : "No"}</td>
                                        <td style={{ padding: "8px" }}>{a.sortOrder}</td>
                                        <td style={{ padding: "8px" }}>
                                            <s-stack direction="inline" gap="tight">
                                                <s-button variant="tertiary" onClick={() => setEditingId(a.id)}>Edit</s-button>
                                                <fetcher.Form method="post">
                                                    <input type="hidden" name="intent" value="delete" />
                                                    <input type="hidden" name="id" value={a.id} />
                                                    <s-button variant="tertiary" tone="critical" type="submit"
                                                        onClick={(e) => { if (!confirm(`Delete "${a.label}"?`)) e.preventDefault(); }}>
                                                        Delete
                                                    </s-button>
                                                </fetcher.Form>
                                            </s-stack>
                                        </td>
                                    </>
                                )}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </s-section>
        </s-page>
    );
}