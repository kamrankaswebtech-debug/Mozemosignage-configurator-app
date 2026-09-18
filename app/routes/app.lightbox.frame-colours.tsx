import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

type ColourEntry = { id: string; label: string; hexCode: string; extraPrice: string; sortOrder: string };

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { admin } = await authenticate.admin(request);
    const response = await admin.graphql(`#graphql
    query ListFrameColours { metaobjects(type: "$app:lightbox_option", first: 100) { edges { node { id fields { key value } } } } }`);
    const data = await response.json();
    const all = data.data.metaobjects.edges.map((edge: any) => {
        const f: Record<string, string> = {};
        edge.node.fields.forEach((x: any) => { f[x.key] = x.value; });
        return { id: edge.node.id, label: f.label || "", hexCode: f.hex_code || "", extraPrice: f.extra_price_decimal || "0", sortOrder: f.sort_order || "0", category: f.category || "" };
    });
    const colours: ColourEntry[] = all.filter((a: any) => a.category === "frame_colour");
    colours.sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder));
    return { colours };
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const { admin } = await authenticate.admin(request);
    const formData = await request.formData();
    const intent = formData.get("intent");
    const fields = [
        { key: "label", value: String(formData.get("label") || "") },
        { key: "hex_code", value: String(formData.get("hexCode") || "") },
        { key: "extra_price_decimal", value: String(formData.get("extraPrice") || "0") },
        { key: "sort_order", value: String(formData.get("sortOrder") || "0") },
        { key: "category", value: "frame_colour" },
    ];

    if (intent === "create") {
        const response = await admin.graphql(`#graphql
      mutation CreateFrameColour($metaobject: MetaobjectCreateInput!) { metaobjectCreate(metaobject: $metaobject) { metaobject { id } userErrors { field message } } }`,
            { variables: { metaobject: { type: "$app:lightbox_option", fields } } });
        const data = await response.json();
        const errors = data.data?.metaobjectCreate?.userErrors;
        if (errors?.length) return { error: errors[0].message };
        return { success: true };
    }
    if (intent === "update") {
        const id = String(formData.get("id"));
        const response = await admin.graphql(`#graphql
      mutation UpdateFrameColour($id: ID!, $metaobject: MetaobjectUpdateInput!) { metaobjectUpdate(id: $id, metaobject: $metaobject) { metaobject { id } userErrors { field message } } }`,
            { variables: { id, metaobject: { fields } } });
        const data = await response.json();
        const errors = data.data?.metaobjectUpdate?.userErrors;
        if (errors?.length) return { error: errors[0].message };
        return { success: true };
    }
    if (intent === "delete") {
        const id = String(formData.get("id"));
        const response = await admin.graphql(`#graphql
      mutation DeleteFrameColour($id: ID!) { metaobjectDelete(id: $id) { deletedId userErrors { field message } } }`,
            { variables: { id } });
        const data = await response.json();
        const errors = data.data?.metaobjectDelete?.userErrors;
        if (errors?.length) return { error: errors[0].message };
        return { success: true };
    }
    return { error: "Unknown action" };
};

export default function LightboxFrameColoursPage() {
    const { colours } = useLoaderData<typeof loader>();
    const fetcher = useFetcher<typeof action>();
    const shopify = useAppBridge();
    const [editingId, setEditingId] = useState<string | null>(null);
    const isSubmitting = fetcher.state !== "idle";

    useEffect(() => {
        if (fetcher.data && "success" in fetcher.data && fetcher.data.success) { shopify.toast.show("Saved successfully"); setEditingId(null); }
        if (fetcher.data && "error" in fetcher.data && fetcher.data.error) shopify.toast.show(fetcher.data.error, { isError: true });
    }, [fetcher.data, shopify]);

    return (
        <s-page heading="Lightbox Frame Colours">
            <s-section heading="Add New Frame Colour">
                <s-link href="/app/lightbox">← Back to Lightbox Range</s-link>
                <s-paragraph>Per the client's spec: Black, White, Light Grey, Dark Grey, Silver, Red, Orange, Yellow, Light Blue, Dark Blue/Navy, Green, Dark Green, Purple, Pink, Maroon, Custom Colour.</s-paragraph>
                <fetcher.Form method="post">
                    <input type="hidden" name="intent" value="create" />
                    <s-stack direction="inline" gap="base">
                        <input type="text" name="label" placeholder="Label (e.g. Black)" required />
                        <input type="text" name="hexCode" placeholder="#1A1A1A (leave blank for Custom Colour)" />
                        <input type="number" step="0.01" name="extraPrice" placeholder="Extra Price" defaultValue="0" />
                        <input type="number" name="sortOrder" placeholder="Sort Order" defaultValue={colours.length + 1} />
                        <s-button type="submit" {...(isSubmitting ? { loading: true } : {})}>Add Colour</s-button>
                    </s-stack>
                </fetcher.Form>
            </s-section>

            <s-section heading={`Existing Frame Colours (${colours.length})`}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                        <tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
                            <th style={{ padding: "8px" }}>Label</th><th style={{ padding: "8px" }}>Hex</th>
                            <th style={{ padding: "8px" }}>Extra Price</th><th style={{ padding: "8px" }}>Sort Order</th><th style={{ padding: "8px" }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {colours.map((c) => (
                            <tr key={c.id} style={{ borderBottom: "1px solid #eee" }}>
                                {editingId === c.id ? (
                                    <td colSpan={5} style={{ padding: "8px" }}>
                                        <fetcher.Form method="post">
                                            <input type="hidden" name="intent" value="update" />
                                            <input type="hidden" name="id" value={c.id} />
                                            <s-stack direction="inline" gap="base">
                                                <input type="text" name="label" defaultValue={c.label} required />
                                                <input type="text" name="hexCode" defaultValue={c.hexCode} />
                                                <input type="number" step="0.01" name="extraPrice" defaultValue={c.extraPrice} />
                                                <input type="number" name="sortOrder" defaultValue={c.sortOrder} />
                                                <s-button type="submit" {...(isSubmitting ? { loading: true } : {})}>Save</s-button>
                                                <s-button variant="tertiary" onClick={() => setEditingId(null)}>Cancel</s-button>
                                            </s-stack>
                                        </fetcher.Form>
                                    </td>
                                ) : (
                                    <>
                                        <td style={{ padding: "8px" }}>{c.label}</td>
                                        <td style={{ padding: "8px" }}>
                                            <span style={{ display: "inline-block", width: 16, height: 16, borderRadius: "50%", background: c.hexCode || "#ccc", marginRight: 6, verticalAlign: "middle" }} />
                                            {c.hexCode || "—"}
                                        </td>
                                        <td style={{ padding: "8px" }}>${c.extraPrice}</td><td style={{ padding: "8px" }}>{c.sortOrder}</td>
                                        <td style={{ padding: "8px" }}>
                                            <s-stack direction="inline" gap="tight">
                                                <s-button variant="tertiary" onClick={() => setEditingId(c.id)}>Edit</s-button>
                                                <fetcher.Form method="post">
                                                    <input type="hidden" name="intent" value="delete" /><input type="hidden" name="id" value={c.id} />
                                                    <s-button variant="tertiary" tone="critical" type="submit" onClick={(e) => { if (!confirm(`Delete "${c.label}"?`)) e.preventDefault(); }}>Delete</s-button>
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