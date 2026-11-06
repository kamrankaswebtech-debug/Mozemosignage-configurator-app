import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

// Event Marquee — Plastic LED bulb colours shown under "Bulb Type" on the storefront
// (event_marquee_option, category "bulb_colour"). Every colour is included in the price, so
// there is no price field. No rows = the storefront uses the client's 7 colours below.
const CATEGORY = "bulb_colour";
const CLIENT_BULB_COLOURS = [
    { label: "Cool White", hex: "#eef4ff" },
    { label: "Warm White", hex: "#ffd9a0" },
    { label: "Yellow", hex: "#ffd60a" },
    { label: "Red", hex: "#e8202e" },
    { label: "Blue", hex: "#1f5bff" },
    { label: "Green", hex: "#1fbf4a" },
    { label: "Purple", hex: "#9b30ff" },
];
type Entry = { id: string; label: string; hexCode: string; sortOrder: string };

async function listBulbColours(admin: any): Promise<Entry[]> {
    const response = await admin.graphql(
        `#graphql
    query List { metaobjects(type: "$app:event_marquee_option", first: 250) { edges { node { id fields { key value } } } } }`
    );
    const data = await response.json();
    return data.data.metaobjects.edges
        .map((edge: any) => {
            const f: Record<string, string> = {};
            edge.node.fields.forEach((x: any) => { f[x.key] = x.value; });
            return { id: edge.node.id, category: String(f.category || "").trim().toLowerCase(), label: f.label || "", hexCode: f.hex_code || "#ffffff", sortOrder: f.sort_order || "0" };
        })
        .filter((item: any) => item.category === CATEGORY);
}

async function createColour(admin: any, label: string, hexCode: string, sortOrder: string) {
    const response = await admin.graphql(
        `#graphql
      mutation Create($metaobject: MetaobjectCreateInput!) {
        metaobjectCreate(metaobject: $metaobject) { metaobject { id } userErrors { field message } }
      }`,
        {
            variables: {
                metaobject: {
                    type: "$app:event_marquee_option",
                    fields: [
                        { key: "category", value: CATEGORY },
                        { key: "label", value: label },
                        { key: "hex_code", value: hexCode },
                        { key: "extra_price_decimal", value: "0" },
                        { key: "sort_order", value: sortOrder },
                    ],
                },
            },
        }
    );
    const data = await response.json();
    const errors = data.data?.metaobjectCreate?.userErrors;
    return errors?.length ? (errors[0].message as string) : null;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { admin } = await authenticate.admin(request);
    const items = await listBulbColours(admin);
    items.sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder));
    return { items };
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const { admin } = await authenticate.admin(request);
    const formData = await request.formData();
    const intent = formData.get("intent");

    if (intent === "load-list") {
        // Adds only the client colours that are not in the list yet (matched by name).
        const have = new Set((await listBulbColours(admin)).map((c) => c.label.trim().toLowerCase()));
        for (let i = 0; i < CLIENT_BULB_COLOURS.length; i++) {
            const c = CLIENT_BULB_COLOURS[i];
            if (have.has(c.label.toLowerCase())) continue;
            const error = await createColour(admin, c.label, c.hex, String(i + 1));
            if (error) return { error };
        }
        return { success: true };
    }

    if (intent === "create") {
        const error = await createColour(admin, String(formData.get("label") || ""), String(formData.get("hexCode") || "#ffffff"), String(formData.get("sortOrder") || "0"));
        return error ? { error } : { success: true };
    }

    if (intent === "update") {
        const id = String(formData.get("id"));
        const response = await admin.graphql(
            `#graphql
      mutation Update($id: ID!, $metaobject: MetaobjectUpdateInput!) {
        metaobjectUpdate(id: $id, metaobject: $metaobject) { metaobject { id } userErrors { field message } }
      }`,
            {
                variables: {
                    id,
                    metaobject: {
                        fields: [
                            { key: "label", value: String(formData.get("label") || "") },
                            { key: "hex_code", value: String(formData.get("hexCode") || "#ffffff") },
                            { key: "sort_order", value: String(formData.get("sortOrder") || "0") },
                        ],
                    },
                },
            }
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

export default function BulbColoursPage() {
    const { items } = useLoaderData<typeof loader>();
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
        <s-page heading="Plastic LED Bulb Colours">
            <s-section heading="Bulb colours on the storefront">
                <s-link href="/app/event-marquee">← Back to Event Marquee</s-link>
                <s-paragraph>
                    Colours customers can pick for the Plastic LED Bulbs (2W per bulb). Every colour, the Traditional Clear Glass
                    Bulbs (warm white) and the customer&apos;s own colour combinations are all included in the price.
                    {items.length === 0 ? " No colours saved yet — the storefront shows the client's 7 colours: " + CLIENT_BULB_COLOURS.map((c) => c.label).join(", ") + "." : ""}
                </s-paragraph>
                <fetcher.Form method="post">
                    <input type="hidden" name="intent" value="load-list" />
                    <s-button type="submit" variant="secondary" {...(isSubmitting ? { loading: true } : {})}>Load the client&apos;s 7 colours</s-button>
                </fetcher.Form>
            </s-section>

            <s-section heading="Add New Bulb Colour">
                <fetcher.Form method="post">
                    <input type="hidden" name="intent" value="create" />
                    <s-stack direction="inline" gap="base">
                        <input type="text" name="label" placeholder="Name (e.g. Warm White)" required />
                        <input type="color" name="hexCode" defaultValue="#ffd9a0" />
                        <input type="number" name="sortOrder" placeholder="Sort Order" defaultValue={items.length + 1} />
                        <s-button type="submit" {...(isSubmitting ? { loading: true } : {})}>Add</s-button>
                    </s-stack>
                </fetcher.Form>
            </s-section>

            <s-section heading={`Existing (${items.length})`}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                        <tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
                            <th style={{ padding: "8px" }}>Name</th>
                            <th style={{ padding: "8px" }}>Colour</th>
                            <th style={{ padding: "8px" }}>Sort Order</th>
                            <th style={{ padding: "8px" }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {items.map((item) => (
                            <tr key={item.id} style={{ borderBottom: "1px solid #eee" }}>
                                {editingId === item.id ? (
                                    <td colSpan={4} style={{ padding: "8px" }}>
                                        <fetcher.Form method="post">
                                            <input type="hidden" name="intent" value="update" />
                                            <input type="hidden" name="id" value={item.id} />
                                            <s-stack direction="inline" gap="base">
                                                <input type="text" name="label" defaultValue={item.label} required />
                                                <input type="color" name="hexCode" defaultValue={/^#[0-9a-f]{6}$/i.test(item.hexCode) ? item.hexCode : "#ffffff"} />
                                                <input type="number" name="sortOrder" defaultValue={item.sortOrder} />
                                                <s-button type="submit" {...(isSubmitting ? { loading: true } : {})}>Save</s-button>
                                                <s-button variant="tertiary" onClick={() => setEditingId(null)}>Cancel</s-button>
                                            </s-stack>
                                        </fetcher.Form>
                                    </td>
                                ) : (
                                    <>
                                        <td style={{ padding: "8px" }}>{item.label}</td>
                                        <td style={{ padding: "8px" }}>
                                            <span style={{ display: "inline-block", width: "14px", height: "14px", borderRadius: "50%", background: item.hexCode, border: "1px solid #ccc", marginRight: "6px", verticalAlign: "middle" }}></span>
                                            {item.hexCode}
                                        </td>
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
