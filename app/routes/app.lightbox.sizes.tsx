import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

// Lightbox size + price boxes (category = "price_row" in lightbox_option): one row per size with
// its single-sided price (extra_price_decimal) and double-sided price (price_double_decimal,
// empty = not offered double-sided). No rows = the storefront keeps the width slider.
type SizeEntry = { id: string; label: string; singlePrice: string; doublePrice: string; sortOrder: string };

// The client's price list. "Load" only adds the sizes that are not in the list yet.
const CLIENT_PRICE_LIST = [
    { label: "30 cm", single: "330", double: "420" },
    { label: "40 cm", single: "410", double: "470" },
    { label: "50 cm", single: "460", double: "520" },
    { label: "60 cm", single: "490", double: "620" },
    { label: "70 cm", single: "620", double: "740" },
    { label: "80 cm", single: "700", double: "910" },
    { label: "90 cm", single: "1020", double: "" },
    { label: "100 cm", single: "1190", double: "" },
    { label: "110 cm", single: "1490", double: "" },
    { label: "120 cm", single: "1670", double: "" },
];

async function listOptions(admin: any) {
    const response = await admin.graphql(`#graphql
    query ListLightboxSizes { metaobjects(type: "$app:lightbox_option", first: 250) { edges { node { id fields { key value } } } } }`);
    const data = await response.json();
    return data.data.metaobjects.edges.map((edge: any) => {
        const f: Record<string, string> = {};
        edge.node.fields.forEach((x: any) => { f[x.key] = x.value; });
        return { id: edge.node.id, label: f.label || "", singlePrice: f.extra_price_decimal || "0", doublePrice: f.price_double_decimal || "", sortOrder: f.sort_order || "0", category: f.category || "" };
    });
}

async function createRow(admin: any, label: string, single: string, double: string, sortOrder: string) {
    const fields = [
        { key: "category", value: "price_row" },
        { key: "label", value: label },
        { key: "extra_price_decimal", value: single || "0" },
        { key: "sort_order", value: sortOrder || "0" },
    ];
    if (double) fields.push({ key: "price_double_decimal", value: double });
    const response = await admin.graphql(`#graphql
      mutation CreateLightboxSize($metaobject: MetaobjectCreateInput!) { metaobjectCreate(metaobject: $metaobject) { metaobject { id } userErrors { field message } } }`,
        { variables: { metaobject: { type: "$app:lightbox_option", fields } } });
    const data = await response.json();
    const errors = data.data?.metaobjectCreate?.userErrors;
    return errors?.length ? errors[0].message as string : null;
}

async function deleteRow(admin: any, id: string) {
    const response = await admin.graphql(`#graphql
      mutation DeleteLightboxSize($id: ID!) { metaobjectDelete(id: $id) { deletedId userErrors { field message } } }`,
        { variables: { id } });
    const data = await response.json();
    const errors = data.data?.metaobjectDelete?.userErrors;
    return errors?.length ? errors[0].message as string : null;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { admin } = await authenticate.admin(request);
    const all = await listOptions(admin);
    const sizes: SizeEntry[] = all.filter((a: any) => a.category === "price_row");
    sizes.sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder));
    // Rows of the old Lightbox size list (category "size"): no longer read by the storefront.
    const oldRowCount = all.filter((a: any) => a.category === "size").length;
    return { sizes, oldRowCount };
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const { admin } = await authenticate.admin(request);
    const formData = await request.formData();
    const intent = formData.get("intent");

    if (intent === "load-list") {
        const existing = (await listOptions(admin)).filter((a: any) => a.category === "price_row");
        const have = new Set(existing.map((a: any) => parseFloat(a.label)));
        for (let i = 0; i < CLIENT_PRICE_LIST.length; i++) {
            const row = CLIENT_PRICE_LIST[i];
            if (have.has(parseFloat(row.label))) continue;
            const error = await createRow(admin, row.label, row.single, row.double, String(i + 1));
            if (error) return { error };
        }
        return { success: true };
    }
    if (intent === "delete-old") {
        const old = (await listOptions(admin)).filter((a: any) => a.category === "size");
        for (const row of old) {
            const error = await deleteRow(admin, row.id);
            if (error) return { error };
        }
        return { success: true };
    }
    if (intent === "create") {
        const error = await createRow(admin, String(formData.get("label") || ""), String(formData.get("singlePrice") || "0"), String(formData.get("doublePrice") || ""), String(formData.get("sortOrder") || "0"));
        return error ? { error } : { success: true };
    }
    if (intent === "update") {
        const id = String(formData.get("id"));
        const fields = [
            { key: "label", value: String(formData.get("label") || "") },
            { key: "extra_price_decimal", value: String(formData.get("singlePrice") || "0") },
            { key: "price_double_decimal", value: String(formData.get("doublePrice") || "") },
            { key: "sort_order", value: String(formData.get("sortOrder") || "0") },
        ];
        const response = await admin.graphql(`#graphql
      mutation UpdateLightboxSize($id: ID!, $metaobject: MetaobjectUpdateInput!) { metaobjectUpdate(id: $id, metaobject: $metaobject) { metaobject { id } userErrors { field message } } }`,
            { variables: { id, metaobject: { fields } } });
        const data = await response.json();
        const errors = data.data?.metaobjectUpdate?.userErrors;
        if (errors?.length) return { error: errors[0].message };
        return { success: true };
    }
    if (intent === "delete") {
        const error = await deleteRow(admin, String(formData.get("id")));
        return error ? { error } : { success: true };
    }
    return { error: "Unknown action" };
};

export default function LightboxSizesPage() {
    const { sizes, oldRowCount } = useLoaderData<typeof loader>();
    const fetcher = useFetcher<typeof action>();
    const shopify = useAppBridge();
    const [editingId, setEditingId] = useState<string | null>(null);
    const isSubmitting = fetcher.state !== "idle";

    useEffect(() => {
        if (fetcher.data && "success" in fetcher.data && fetcher.data.success) { shopify.toast.show("Saved successfully"); setEditingId(null); }
        if (fetcher.data && "error" in fetcher.data && fetcher.data.error) shopify.toast.show(fetcher.data.error, { isError: true });
    }, [fetcher.data, shopify]);

    return (
        <s-page heading="Lightbox Sizes & Prices">
            <s-section heading="Add New Size">
                <s-link href="/app/lightbox">← Back to 3D LED Lightbox</s-link>
                <s-paragraph>Each row is one size box on the storefront. Put the width first in the label (e.g. "60 cm"). Leave Double-Sided Price empty if the size is not offered double-sided. While this list is empty the storefront shows the width slider.</s-paragraph>
                <fetcher.Form method="post">
                    <input type="hidden" name="intent" value="create" />
                    <s-stack direction="inline" gap="base">
                        <input type="text" name="label" placeholder="Label (e.g. 30 cm)" required />
                        <input type="number" step="0.01" name="singlePrice" placeholder="Single-Sided Price" required />
                        <input type="number" step="0.01" name="doublePrice" placeholder="Double-Sided Price" />
                        <input type="number" name="sortOrder" placeholder="Sort Order" defaultValue={sizes.length + 1} />
                        <s-button type="submit" {...(isSubmitting ? { loading: true } : {})}>Add Size</s-button>
                    </s-stack>
                </fetcher.Form>
                <fetcher.Form method="post" style={{ marginTop: 12 }}>
                    <input type="hidden" name="intent" value="load-list" />
                    <s-button type="submit" variant="secondary" {...(isSubmitting ? { loading: true } : {})}>Load Client Price List (30–120 cm)</s-button>
                </fetcher.Form>
            </s-section>

            <s-section heading={`Existing Sizes (${sizes.length})`}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                        <tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
                            <th style={{ padding: "8px" }}>Label</th><th style={{ padding: "8px" }}>Single-Sided Price</th><th style={{ padding: "8px" }}>Double-Sided Price</th>
                            <th style={{ padding: "8px" }}>Sort Order</th><th style={{ padding: "8px" }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {sizes.map((s) => (
                            <tr key={s.id} style={{ borderBottom: "1px solid #eee" }}>
                                {editingId === s.id ? (
                                    <td colSpan={5} style={{ padding: "8px" }}>
                                        <fetcher.Form method="post">
                                            <input type="hidden" name="intent" value="update" />
                                            <input type="hidden" name="id" value={s.id} />
                                            <s-stack direction="inline" gap="base">
                                                <input type="text" name="label" defaultValue={s.label} required />
                                                <input type="number" step="0.01" name="singlePrice" defaultValue={s.singlePrice} required />
                                                <input type="number" step="0.01" name="doublePrice" defaultValue={s.doublePrice} placeholder="Double-Sided Price" />
                                                <input type="number" name="sortOrder" defaultValue={s.sortOrder} />
                                                <s-button type="submit" {...(isSubmitting ? { loading: true } : {})}>Save</s-button>
                                                <s-button variant="tertiary" onClick={() => setEditingId(null)}>Cancel</s-button>
                                            </s-stack>
                                        </fetcher.Form>
                                    </td>
                                ) : (
                                    <>
                                        <td style={{ padding: "8px" }}>{s.label}</td><td style={{ padding: "8px" }}>${s.singlePrice}</td>
                                        <td style={{ padding: "8px" }}>{s.doublePrice ? `$${s.doublePrice}` : "Not offered"}</td><td style={{ padding: "8px" }}>{s.sortOrder}</td>
                                        <td style={{ padding: "8px" }}>
                                            <s-stack direction="inline" gap="tight">
                                                <s-button variant="tertiary" onClick={() => setEditingId(s.id)}>Edit</s-button>
                                                <fetcher.Form method="post">
                                                    <input type="hidden" name="intent" value="delete" /><input type="hidden" name="id" value={s.id} />
                                                    <s-button variant="tertiary" tone="critical" type="submit" onClick={(e) => { if (!confirm(`Delete "${s.label}"?`)) e.preventDefault(); }}>Delete</s-button>
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

            {oldRowCount > 0 && (
                <s-section heading="Old size rows">
                    <s-paragraph>{oldRowCount} rows from the old Lightbox size list are still saved. The storefront no longer reads them, so they can be removed.</s-paragraph>
                    <fetcher.Form method="post">
                        <input type="hidden" name="intent" value="delete-old" />
                        <s-button type="submit" variant="tertiary" tone="critical" onClick={(e) => { if (!confirm(`Delete ${oldRowCount} old size rows?`)) e.preventDefault(); }}>Remove Old Rows</s-button>
                    </fetcher.Form>
                </s-section>
            )}
        </s-page>
    );
}
