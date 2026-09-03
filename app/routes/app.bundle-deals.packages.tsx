import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

const CATEGORY = "package";
type Entry = { id: string; label: string; description: string; price: string; sortOrder: string };

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { admin } = await authenticate.admin(request);
    const response = await admin.graphql(
        `#graphql
    query List { metaobjects(type: "$app:bundle_option", first: 100) { edges { node { id fields { key value } } } } }`
    );
    const data = await response.json();
    const items: Entry[] = data.data.metaobjects.edges
        .map((edge: any) => {
            const f: Record<string, string> = {};
            edge.node.fields.forEach((x: any) => { f[x.key] = x.value; });
            return { id: edge.node.id, category: f.category, label: f.label || "", description: f.description || "", price: f.price_decimal || "0", sortOrder: f.sort_order || "0" };
        })
        .filter((item: any) => item.category === CATEGORY);
    items.sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder));
    return { items };
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const { admin } = await authenticate.admin(request);
    const formData = await request.formData();
    const intent = formData.get("intent");
    const fields = [
        { key: "category", value: CATEGORY },
        { key: "label", value: String(formData.get("label") || "") },
        { key: "description", value: String(formData.get("description") || "") },
        { key: "price_decimal", value: String(formData.get("price") || "0") },
        { key: "sort_order", value: String(formData.get("sortOrder") || "0") },
    ];

    if (intent === "create") {
        const response = await admin.graphql(
            `#graphql
      mutation Create($metaobject: MetaobjectCreateInput!) {
        metaobjectCreate(metaobject: $metaobject) { metaobject { id } userErrors { field message } }
      }`,
            { variables: { metaobject: { type: "$app:bundle_option", fields } } }
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
      mutation Update($id: ID!, $metaobject: MetaobjectUpdateInput!) {
        metaobjectUpdate(id: $id, metaobject: $metaobject) { metaobject { id } userErrors { field message } }
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
      mutation Delete($id: ID!) { metaobjectDelete(id: $id) { deletedId userErrors { field message } } }`,
            { variables: { id } }
        );
        const data = await response.json();
        const errors = data.data?.metaobjectDelete?.userErrors;
        if (errors?.length) return { error: errors[0].message };
        return { success: true };
    }
    return { error: "Unknown action" };
};

export default function PackagesPage() {
    const { items } = useLoaderData<typeof loader>();
    const fetcher = useFetcher<typeof action>();
    const shopify = useAppBridge();
    const revalidator = useRevalidator();
    const [editingId, setEditingId] = useState<string | null>(null);
    const isSubmitting = fetcher.state !== "idle";

    useEffect(() => {
        if (fetcher.data && "success" in fetcher.data && fetcher.data.success) {
            shopify.toast.show("Saved successfully");
            setEditingId(null);
            setTimeout(() => revalidator.revalidate(), 800);
        }
        if (fetcher.data && "error" in fetcher.data && fetcher.data.error) {
            shopify.toast.show(fetcher.data.error, { isError: true });
        }
    }, [fetcher.data, shopify]);

    return (
        <s-page heading="Packages">
            <s-section heading="Add New Package">
                <s-link href="/app/bundle-deals">← Back to Bundle Deals</s-link>
                <fetcher.Form method="post">
                    <input type="hidden" name="intent" value="create" />
                    <s-stack direction="block" gap="base">
                        <input type="text" name="label" placeholder="Package Name (e.g. Starter Fit-Out)" required />
                        <textarea name="description" placeholder="What's included in this package" rows={2} style={{ width: "100%" }}></textarea>
                        <s-stack direction="inline" gap="base">
                            <input type="number" step="0.01" name="price" placeholder="Base Price" defaultValue="0" required />
                            <input type="number" name="sortOrder" placeholder="Sort Order" defaultValue={items.length + 1} />
                            <s-button type="submit" {...(isSubmitting ? { loading: true } : {})}>Add</s-button>
                        </s-stack>
                    </s-stack>
                </fetcher.Form>
            </s-section>

            <s-section heading={`Existing (${items.length})`}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                        <tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
                            <th style={{ padding: "8px" }}>Label</th>
                            <th style={{ padding: "8px" }}>Description</th>
                            <th style={{ padding: "8px" }}>Price</th>
                            <th style={{ padding: "8px" }}>Sort Order</th>
                            <th style={{ padding: "8px" }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {items.map((item) => (
                            <tr key={item.id} style={{ borderBottom: "1px solid #eee" }}>
                                {editingId === item.id ? (
                                    <td colSpan={5} style={{ padding: "8px" }}>
                                        <fetcher.Form method="post">
                                            <input type="hidden" name="intent" value="update" />
                                            <input type="hidden" name="id" value={item.id} />
                                            <s-stack direction="block" gap="base">
                                                <input type="text" name="label" defaultValue={item.label} required />
                                                <textarea name="description" defaultValue={item.description} rows={2} style={{ width: "100%" }}></textarea>
                                                <s-stack direction="inline" gap="base">
                                                    <input type="number" step="0.01" name="price" defaultValue={item.price} required />
                                                    <input type="number" name="sortOrder" defaultValue={item.sortOrder} />
                                                    <s-button type="submit" {...(isSubmitting ? { loading: true } : {})}>Save</s-button>
                                                    <s-button variant="tertiary" onClick={() => setEditingId(null)}>Cancel</s-button>
                                                </s-stack>
                                            </s-stack>
                                        </fetcher.Form>
                                    </td>
                                ) : (
                                    <>
                                        <td style={{ padding: "8px" }}>{item.label}</td>
                                        <td style={{ padding: "8px" }}>{item.description}</td>
                                        <td style={{ padding: "8px" }}>${item.price}</td>
                                        <td style={{ padding: "8px" }}>{item.sortOrder}</td>
                                        <td style={{ padding: "8px" }}>
                                            <s-stack direction="inline" gap="tight">
                                                <s-button variant="tertiary" onClick={() => setEditingId(item.id)}>Edit</s-button>
                                                <fetcher.Form method="post">
                                                    <input type="hidden" name="intent" value="delete" />
                                                    <input type="hidden" name="id" value={item.id} />
                                                    <s-button variant="tertiary" tone="critical" type="submit"
                                                        onClick={(e) => { if (!confirm(`Delete "${item.label}"?`)) e.preventDefault(); }}>
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