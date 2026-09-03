import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

type SizeEntry = {
    id: string;
    label: string;
    widthCm: string;
    heightCm: string;
    price: string;
    sortOrder: string;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { admin } = await authenticate.admin(request);
    const response = await admin.graphql(
        `#graphql
    query ListSignSizes {
      metaobjects(type: "$app:sign_size", first: 100) {
        edges { node { id fields { key value } } }
      }
    }`
    );
    const data = await response.json();
    const sizes: SizeEntry[] = data.data.metaobjects.edges.map((edge: any) => {
        const f: Record<string, string> = {};
        edge.node.fields.forEach((x: any) => { f[x.key] = x.value; });
        return {
            id: edge.node.id,
            label: f.label || "",
            widthCm: f.width_cm || "0",
            heightCm: f.height_cm || "0",
            price: f.price_decimal || "0",
            sortOrder: f.sort_order || "0",
        };
    });
    sizes.sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder));
    return { sizes };
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const { admin } = await authenticate.admin(request);
    const formData = await request.formData();
    const intent = formData.get("intent");

    const fields = [
        { key: "label", value: String(formData.get("label") || "") },
        { key: "width_cm", value: String(formData.get("widthCm") || "0") },
        { key: "height_cm", value: String(formData.get("heightCm") || "0") },
        { key: "price_decimal", value: String(formData.get("price") || "0") },
        { key: "sort_order", value: String(formData.get("sortOrder") || "0") },
    ];

    if (intent === "create") {
        const response = await admin.graphql(
            `#graphql
      mutation CreateSignSize($metaobject: MetaobjectCreateInput!) {
        metaobjectCreate(metaobject: $metaobject) {
          metaobject { id }
          userErrors { field message }
        }
      }`,
            { variables: { metaobject: { type: "$app:sign_size", fields } } }
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
      mutation UpdateSignSize($id: ID!, $metaobject: MetaobjectUpdateInput!) {
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
      mutation DeleteSignSize($id: ID!) {
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

export default function SignSizesPage() {
    const { sizes } = useLoaderData<typeof loader>();
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
        <s-page heading="Sign Sizes">
            <s-section heading="Add New Size">
                <s-link href="/app/neon-signs">← Back to Neon Signs</s-link>
                <fetcher.Form method="post">
                    <input type="hidden" name="intent" value="create" />
                    <s-stack direction="inline" gap="base">
                        <input type="text" name="label" placeholder="Label (e.g. Small - 45cm)" required />
                        <input type="number" step="0.1" name="widthCm" placeholder="Width (cm)" required />
                        <input type="number" step="0.1" name="heightCm" placeholder="Height (cm)" required />
                        <input type="number" step="0.01" name="price" placeholder="Price" required />
                        <input type="number" name="sortOrder" placeholder="Sort Order" defaultValue={sizes.length + 1} />
                        <s-button type="submit" {...(isSubmitting ? { loading: true } : {})}>Add Size</s-button>
                    </s-stack>
                </fetcher.Form>
            </s-section>

            <s-section heading={`Existing Sizes (${sizes.length})`}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                        <tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
                            <th style={{ padding: "8px" }}>Label</th>
                            <th style={{ padding: "8px" }}>Width (cm)</th>
                            <th style={{ padding: "8px" }}>Height (cm)</th>
                            <th style={{ padding: "8px" }}>Price</th>
                            <th style={{ padding: "8px" }}>Sort Order</th>
                            <th style={{ padding: "8px" }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {sizes.map((s) => (
                            <tr key={s.id} style={{ borderBottom: "1px solid #eee" }}>
                                {editingId === s.id ? (
                                    <td colSpan={6} style={{ padding: "8px" }}>
                                        <fetcher.Form method="post">
                                            <input type="hidden" name="intent" value="update" />
                                            <input type="hidden" name="id" value={s.id} />
                                            <s-stack direction="inline" gap="base">
                                                <input type="text" name="label" defaultValue={s.label} required />
                                                <input type="number" step="0.1" name="widthCm" defaultValue={s.widthCm} required />
                                                <input type="number" step="0.1" name="heightCm" defaultValue={s.heightCm} required />
                                                <input type="number" step="0.01" name="price" defaultValue={s.price} required />
                                                <input type="number" name="sortOrder" defaultValue={s.sortOrder} />
                                                <s-button type="submit" {...(isSubmitting ? { loading: true } : {})}>Save</s-button>
                                                <s-button variant="tertiary" onClick={() => setEditingId(null)}>Cancel</s-button>
                                            </s-stack>
                                        </fetcher.Form>
                                    </td>
                                ) : (
                                    <>
                                        <td style={{ padding: "8px" }}>{s.label}</td>
                                        <td style={{ padding: "8px" }}>{s.widthCm}</td>
                                        <td style={{ padding: "8px" }}>{s.heightCm}</td>
                                        <td style={{ padding: "8px" }}>${s.price}</td>
                                        <td style={{ padding: "8px" }}>{s.sortOrder}</td>
                                        <td style={{ padding: "8px" }}>
                                            <s-stack direction="inline" gap="tight">
                                                <s-button variant="tertiary" onClick={() => setEditingId(s.id)}>Edit</s-button>
                                                <fetcher.Form method="post">
                                                    <input type="hidden" name="intent" value="delete" />
                                                    <input type="hidden" name="id" value={s.id} />
                                                    <s-button variant="tertiary" tone="critical" type="submit"
                                                        onClick={(e) => { if (!confirm(`Delete size "${s.label}"?`)) e.preventDefault(); }}>
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