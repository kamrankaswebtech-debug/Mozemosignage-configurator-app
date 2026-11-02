import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

// Letter / element height boxes of the Event Marquee and Infinity Mirror configurators.
// Stored as event_marquee_option entries with category "letter_height". show_on = marquee, infinity
// or both. No rows for a product = the storefront keeps the typed letter height.
const CATEGORY = "letter_height";
type Entry = { id: string; label: string; heightCm: string; price: string; sortOrder: string; showOn: string };

const CLIENT_LIST = [
    { label: "3ft / 91.4cm", heightCm: "91.4" },
    { label: "3.2ft / 97.5cm", heightCm: "97.5" },
    { label: "4ft / 121.9cm", heightCm: "121.9" },
    { label: "5ft / 152.4cm", heightCm: "152.4" },
];

const SHOWN_ON: Record<string, string> = { "": "Both", "marquee,infinity": "Both", marquee: "Event Marquee", infinity: "Infinity Mirror" };

async function listItems(admin: any): Promise<Entry[]> {
    const response = await admin.graphql(
        `#graphql
    query List { metaobjects(type: "$app:event_marquee_option", first: 100) { edges { node { id fields { key value } } } } }`
    );
    const data = await response.json();
    return data.data.metaobjects.edges
        .map((edge: any) => {
            const f: Record<string, string> = {};
            edge.node.fields.forEach((x: any) => { f[x.key] = x.value; });
            return { id: edge.node.id, category: f.category, label: f.label || "", heightCm: f.height_cm || "0", price: f.extra_price_decimal || "0", sortOrder: f.sort_order || "0", showOn: f.show_on || "" };
        })
        .filter((item: any) => item.category === CATEGORY);
}

async function createItem(admin: any, label: string, heightCm: string, price: string, sortOrder: string, showOn: string) {
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
                        { key: "height_cm", value: heightCm || "0" },
                        { key: "extra_price_decimal", value: price || "0" },
                        { key: "sort_order", value: sortOrder || "0" },
                        { key: "show_on", value: showOn },
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
    const items = await listItems(admin);
    items.sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder));
    return { items };
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const { admin } = await authenticate.admin(request);
    const formData = await request.formData();
    const intent = formData.get("intent");

    if (intent === "load-list") {
        const have = new Set((await listItems(admin)).map((i) => Number(i.heightCm)));
        for (let i = 0; i < CLIENT_LIST.length; i++) {
            const row = CLIENT_LIST[i];
            if (have.has(Number(row.heightCm))) continue;
            const error = await createItem(admin, row.label, row.heightCm, "0", String(i + 1), "");
            if (error) return { error };
        }
        return { success: true };
    }
    if (intent === "create") {
        const error = await createItem(admin, String(formData.get("label") || ""), String(formData.get("heightCm") || "0"), String(formData.get("price") || "0"), String(formData.get("sortOrder") || "0"), String(formData.get("showOn") || ""));
        return error ? { error } : { success: true };
    }
    if (intent === "update") {
        const id = String(formData.get("id"));
        const fields = [
            { key: "label", value: String(formData.get("label") || "") },
            { key: "height_cm", value: String(formData.get("heightCm") || "0") },
            { key: "extra_price_decimal", value: String(formData.get("price") || "0") },
            { key: "sort_order", value: String(formData.get("sortOrder") || "0") },
            { key: "show_on", value: String(formData.get("showOn") || "") },
        ];
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

function ShowOnSelect({ value }: { value: string }) {
    return (
        <select name="showOn" defaultValue={value === "marquee,infinity" ? "" : value}>
            <option value="">Both</option>
            <option value="marquee">Event Marquee only</option>
            <option value="infinity">Infinity Mirror only</option>
        </select>
    );
}

export default function LetterHeightsPage() {
    const { items } = useLoaderData<typeof loader>();
    const fetcher = useFetcher<typeof action>();
    const shopify = useAppBridge();
    const [editingId, setEditingId] = useState<string | null>(null);
    const isSubmitting = fetcher.state !== "idle";

    useEffect(() => {
        if (fetcher.data && "success" in fetcher.data && fetcher.data.success) { shopify.toast.show("Saved successfully"); setEditingId(null); }
        if (fetcher.data && "error" in fetcher.data && fetcher.data.error) shopify.toast.show(fetcher.data.error, { isError: true });
    }, [fetcher.data, shopify]);

    return (
        <s-page heading="Letter Height Boxes">
            <s-section heading="Add New Height">
                <s-stack direction="inline" gap="base">
                    <s-link href="/app/event-marquee">← Event Marquee</s-link>
                    <s-link href="/app/infinity-mirror">← Infinity Mirror</s-link>
                </s-stack>
                <s-paragraph>Each row is one box in the Letter / Element Height step. Add a row to add a box. Extra Price is added on top of the Letter Height tier price from Pricing Settings. While this list is empty the storefront shows the typed letter height.</s-paragraph>
                <fetcher.Form method="post">
                    <input type="hidden" name="intent" value="create" />
                    <s-stack direction="inline" gap="base">
                        <input type="text" name="label" placeholder="Label (e.g. 3ft / 91.4cm)" required />
                        <input type="number" step="0.1" name="heightCm" placeholder="Height (cm)" required />
                        <input type="number" step="0.01" name="price" placeholder="Extra Price" defaultValue="0" />
                        <input type="number" name="sortOrder" placeholder="Sort Order" defaultValue={items.length + 1} />
                        <ShowOnSelect value="" />
                        <s-button type="submit" {...(isSubmitting ? { loading: true } : {})}>Add Height</s-button>
                    </s-stack>
                </fetcher.Form>
                <fetcher.Form method="post" style={{ marginTop: 12 }}>
                    <input type="hidden" name="intent" value="load-list" />
                    <s-button type="submit" variant="secondary" {...(isSubmitting ? { loading: true } : {})}>Load Client Heights (3ft, 3.2ft, 4ft, 5ft)</s-button>
                </fetcher.Form>
            </s-section>

            <s-section heading={`Existing Heights (${items.length})`}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                        <tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
                            <th style={{ padding: "8px" }}>Label</th><th style={{ padding: "8px" }}>Height (cm)</th><th style={{ padding: "8px" }}>Extra Price</th>
                            <th style={{ padding: "8px" }}>Show On</th><th style={{ padding: "8px" }}>Sort Order</th><th style={{ padding: "8px" }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {items.map((item) => (
                            <tr key={item.id} style={{ borderBottom: "1px solid #eee" }}>
                                {editingId === item.id ? (
                                    <td colSpan={6} style={{ padding: "8px" }}>
                                        <fetcher.Form method="post">
                                            <input type="hidden" name="intent" value="update" />
                                            <input type="hidden" name="id" value={item.id} />
                                            <s-stack direction="inline" gap="base">
                                                <input type="text" name="label" defaultValue={item.label} required />
                                                <input type="number" step="0.1" name="heightCm" defaultValue={item.heightCm} required />
                                                <input type="number" step="0.01" name="price" defaultValue={item.price} />
                                                <input type="number" name="sortOrder" defaultValue={item.sortOrder} />
                                                <ShowOnSelect value={item.showOn} />
                                                <s-button type="submit" {...(isSubmitting ? { loading: true } : {})}>Save</s-button>
                                                <s-button variant="tertiary" onClick={() => setEditingId(null)}>Cancel</s-button>
                                            </s-stack>
                                        </fetcher.Form>
                                    </td>
                                ) : (
                                    <>
                                        <td style={{ padding: "8px" }}>{item.label}</td><td style={{ padding: "8px" }}>{item.heightCm}</td><td style={{ padding: "8px" }}>${item.price}</td>
                                        <td style={{ padding: "8px" }}>{SHOWN_ON[item.showOn] || item.showOn}</td><td style={{ padding: "8px" }}>{item.sortOrder}</td>
                                        <td style={{ padding: "8px" }}>
                                            <s-stack direction="inline" gap="tight">
                                                <s-button variant="tertiary" onClick={() => setEditingId(item.id)}>Edit</s-button>
                                                <fetcher.Form method="post">
                                                    <input type="hidden" name="intent" value="delete" /><input type="hidden" name="id" value={item.id} />
                                                    <s-button variant="tertiary" tone="critical" type="submit" onClick={(e) => { if (!confirm(`Delete "${item.label}"?`)) e.preventDefault(); }}>Delete</s-button>
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
