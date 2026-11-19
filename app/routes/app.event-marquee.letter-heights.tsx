import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

// Letter / element height boxes of the Event Marquee and Infinity Mirror configurators.
// Stored as event_marquee_option entries with category "letter_height". show_on = marquee, infinity
// or both. No rows for a product = the storefront keeps the typed letter height.
const CATEGORY = "letter_height";
type Entry = { id: string; label: string; heightCm: string; price: string; sortOrder: string; showOn: string; widthPrices: string; marqueeWidthPrices: string; sign3dWidthPrices: string };

// Infinity Mirror overall prices (client, AUD) per letter height: overall width (cm) = price.
// "Load Infinity Mirror prices" writes them to the matching heights (Size Prices field).
const WIDTHS_CM = [100, 150, 200, 250, 300, 350, 400, 450, 500];
const INFINITY_PRICES: { heightCm: number; label: string; prices: number[] }[] = [
    { heightCm: 91.4, label: "3ft / 91.4cm", prices: [2620, 2840, 3050, 3270, 3490, 3700, 3920, 4130, 4350] },
    { heightCm: 97.5, label: "3.2ft / 97.5cm", prices: [2630, 2850, 3070, 3290, 3510, 3730, 3950, 4170, 4390] },
    { heightCm: 121.9, label: "4ft / 121.9cm", prices: [2660, 2890, 3120, 3360, 3590, 3820, 4060, 4290, 4530] },
    { heightCm: 152.4, label: "5ft / 152.4cm", prices: [2690, 2940, 3190, 3440, 3700, 3950, 4200, 4450, 4700] },
];
// Event Marquee overall prices (client, AUD) per letter height — field marquee_width_prices.
const MARQUEE_PRICES: { heightCm: number; label: string; prices: number[] }[] = [
    { heightCm: 91.4, label: "3ft / 91.4cm", prices: [1350, 1420, 1490, 1560, 1630, 1700, 1770, 1840, 1910] },
    { heightCm: 97.5, label: "3.2ft / 97.5cm", prices: [1350, 1420, 1490, 1560, 1630, 1700, 1770, 1840, 1910] },
    { heightCm: 121.9, label: "4ft / 121.9cm", prices: [1370, 1450, 1540, 1620, 1700, 1780, 1870, 1950, 2030] },
    { heightCm: 152.4, label: "5ft / 152.4cm", prices: [1370, 1450, 1540, 1620, 1700, 1780, 1870, 1950, 2030] },
];
// 3D Illuminated Signs (client): the same size prices as the Event Marquee; lighting options are
// added on top by the storefront (Illumination Type prices).
const SIGN3D_PRICES = MARQUEE_PRICES;
const priceText = (prices: number[]) => WIDTHS_CM.map((w, i) => w + "=" + prices[i]).join("; ");
// "100=2620; 150=2840" -> readable "1 m $2620 · 1.5 m $2840"
const readable = (v: string) => String(v || "").split(/[;|\n]+/).map((p) => p.trim()).filter(Boolean)
    .map((p) => { const m = p.match(/([\d.]+)\s*(?:cm)?\s*[=:]\s*\$?\s*([\d.,]+)/); return m ? (Number(m[1]) / 100) + " m $" + m[2] : p; }).join(" · ");

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
            return { id: edge.node.id, category: f.category, label: f.label || "", heightCm: f.height_cm || "0", price: f.extra_price_decimal || "0", sortOrder: f.sort_order || "0", showOn: f.show_on || "", widthPrices: f.width_prices || "", marqueeWidthPrices: f.marquee_width_prices || "", sign3dWidthPrices: f.sign3d_width_prices || "" };
        })
        .filter((item: any) => item.category === CATEGORY);
}

async function updateFields(admin: any, id: string, fields: { key: string; value: string }[]) {
    const response = await admin.graphql(
        `#graphql
      mutation Update($id: ID!, $metaobject: MetaobjectUpdateInput!) {
        metaobjectUpdate(id: $id, metaobject: $metaobject) { metaobject { id } userErrors { field message } }
      }`,
        { variables: { id, metaobject: { fields } } }
    );
    const data = await response.json();
    const errors = data.data?.metaobjectUpdate?.userErrors;
    return errors?.length ? (errors[0].message as string) : null;
}

async function createItem(admin: any, label: string, heightCm: string, price: string, sortOrder: string, showOn: string, widthPrices = "", marqueeWidthPrices = "", sign3dWidthPrices = "") {
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
                        ...(widthPrices ? [{ key: "width_prices", value: widthPrices }] : []),
                        ...(marqueeWidthPrices ? [{ key: "marquee_width_prices", value: marqueeWidthPrices }] : []),
                        ...(sign3dWidthPrices ? [{ key: "sign3d_width_prices", value: sign3dWidthPrices }] : []),
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
    if (intent === "load-infinity-prices") {
        // Each client height: fill its Size Prices (existing row with the same height), or add the
        // height when it is missing. Marquee-only rows are not touched (they get a new row).
        const items = await listItems(admin);
        let done = 0;
        for (let i = 0; i < INFINITY_PRICES.length; i++) {
            const row = INFINITY_PRICES[i];
            const hit = items.find((it) => Math.abs(Number(it.heightCm) - row.heightCm) < 0.05 && it.showOn !== "marquee");
            const error = hit
                ? await updateFields(admin, hit.id, [{ key: "width_prices", value: priceText(row.prices) }])
                : await createItem(admin, row.label, String(row.heightCm), "0", String(i + 1), "infinity", priceText(row.prices));
            if (error) return { error: row.label + ": " + error };
            done++;
        }
        return { success: true, message: "Infinity Mirror prices loaded for " + done + " heights." };
    }
    if (intent === "load-3d-prices") {
        // 3D uses its own size prices on the same height rows (the rows' Show On is for Marquee /
        // Infinity only — the 3D configurator reads every row that has 3D size prices).
        const items = await listItems(admin);
        let done = 0;
        for (let i = 0; i < SIGN3D_PRICES.length; i++) {
            const row = SIGN3D_PRICES[i];
            const hit = items.find((it) => Math.abs(Number(it.heightCm) - row.heightCm) < 0.05);
            const error = hit
                ? await updateFields(admin, hit.id, [{ key: "sign3d_width_prices", value: priceText(row.prices) }])
                : await createItem(admin, row.label, String(row.heightCm), "0", String(i + 1), "none", "", "", priceText(row.prices));
            if (error) return { error: row.label + ": " + error };
            done++;
        }
        return { success: true, message: "3D Illuminated Sign prices loaded for " + done + " heights." };
    }
    if (intent === "load-marquee-prices") {
        const items = await listItems(admin);
        let done = 0;
        for (let i = 0; i < MARQUEE_PRICES.length; i++) {
            const row = MARQUEE_PRICES[i];
            const hit = items.find((it) => Math.abs(Number(it.heightCm) - row.heightCm) < 0.05 && it.showOn !== "infinity");
            const error = hit
                ? await updateFields(admin, hit.id, [{ key: "marquee_width_prices", value: priceText(row.prices) }])
                : await createItem(admin, row.label, String(row.heightCm), "0", String(i + 1), "marquee", "", priceText(row.prices));
            if (error) return { error: row.label + ": " + error };
            done++;
        }
        return { success: true, message: "Event Marquee prices loaded for " + done + " heights." };
    }
    if (intent === "create") {
        const error = await createItem(admin, String(formData.get("label") || ""), String(formData.get("heightCm") || "0"), String(formData.get("price") || "0"), String(formData.get("sortOrder") || "0"), String(formData.get("showOn") || ""), String(formData.get("widthPrices") || "").trim(), String(formData.get("marqueeWidthPrices") || "").trim(), String(formData.get("sign3dWidthPrices") || "").trim());
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
            { key: "width_prices", value: String(formData.get("widthPrices") || "").trim() },
            { key: "marquee_width_prices", value: String(formData.get("marqueeWidthPrices") || "").trim() },
            { key: "sign3d_width_prices", value: String(formData.get("sign3dWidthPrices") || "").trim() },
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
        if (fetcher.data && "success" in fetcher.data && fetcher.data.success) { shopify.toast.show((fetcher.data as any).message || "Saved successfully"); setEditingId(null); }
        if (fetcher.data && "error" in fetcher.data && fetcher.data.error) shopify.toast.show(fetcher.data.error, { isError: true });
    }, [fetcher.data, shopify]);

    return (
        <s-page heading="Letter Height Boxes">
            <s-section heading="Add New Height">
                <s-stack direction="inline" gap="base">
                    <s-link href="/app/event-marquee">← Event Marquee</s-link>
                    <s-link href="/app/infinity-mirror">← Infinity Mirror</s-link>
                </s-stack>
                <s-paragraph>
                    Infinity Mirror sizes: "Size Prices" holds the overall price for each overall width at that height, written as
                    width in cm = price, separated by ";" (e.g. 100=2620; 150=2840). With prices set, the Infinity Mirror Text sign shows
                    size boxes (no slider) and charges exactly these prices; 50% of the price is shown as the shipping share. Logo Only
                    keeps the width slider. "Size Prices (Event Marquee)" works the same way for the Event Marquee (40% shown as the
                    shipping share), and "Size Prices (3D)" for 3D Illuminated Signs (Illumination Type prices are added on top).
                </s-paragraph>
                <s-paragraph>Each row is one box in the Letter / Element Height step. Add a row to add a box. Extra Price is added on top of the Letter Height tier price from Pricing Settings. While this list is empty the storefront shows the typed letter height.</s-paragraph>
                <fetcher.Form method="post">
                    <input type="hidden" name="intent" value="create" />
                    <s-stack direction="inline" gap="base">
                        <input type="text" name="label" placeholder="Label (e.g. 3ft / 91.4cm)" required />
                        <input type="number" step="0.1" name="heightCm" placeholder="Height (cm)" required />
                        <input type="number" step="0.01" name="price" placeholder="Extra Price" defaultValue="0" />
                        <input type="number" name="sortOrder" placeholder="Sort Order" defaultValue={items.length + 1} />
                        <ShowOnSelect value="" />
                        <input type="text" name="widthPrices" placeholder="Size Prices (Infinity): 100=2620; 150=2840" style={{ minWidth: 300 }} />
                        <input type="text" name="marqueeWidthPrices" placeholder="Size Prices (Marquee): 100=1350; 150=1420" style={{ minWidth: 300 }} />
                        <input type="text" name="sign3dWidthPrices" placeholder="Size Prices (3D): 100=1350; 150=1420" style={{ minWidth: 300 }} />
                        <s-button type="submit" {...(isSubmitting ? { loading: true } : {})}>Add Height</s-button>
                    </s-stack>
                </fetcher.Form>
                <fetcher.Form method="post" style={{ marginTop: 12 }} onSubmit={(e) => { if (!confirm("Set the client's Infinity Mirror size prices on the 3ft, 3.2ft, 4ft and 5ft heights?")) e.preventDefault(); }}>
                    <input type="hidden" name="intent" value="load-infinity-prices" />
                    <s-button type="submit" variant="primary" {...(isSubmitting ? { loading: true } : {})}>Load Infinity Mirror prices (client table, 1 m – 5 m)</s-button>
                </fetcher.Form>
                <fetcher.Form method="post" style={{ marginTop: 12 }} onSubmit={(e) => { if (!confirm("Set the client's Event Marquee size prices on the 3ft, 3.2ft, 4ft and 5ft heights?")) e.preventDefault(); }}>
                    <input type="hidden" name="intent" value="load-marquee-prices" />
                    <s-button type="submit" variant="primary" {...(isSubmitting ? { loading: true } : {})}>Load Event Marquee prices (client table, 1 m – 5 m)</s-button>
                </fetcher.Form>
                <fetcher.Form method="post" style={{ marginTop: 12 }} onSubmit={(e) => { if (!confirm("Set the client's 3D Illuminated Sign size prices on the 3ft, 3.2ft, 4ft and 5ft heights?")) e.preventDefault(); }}>
                    <input type="hidden" name="intent" value="load-3d-prices" />
                    <s-button type="submit" variant="primary" {...(isSubmitting ? { loading: true } : {})}>Load 3D Illuminated Sign prices (client table, 1 m – 5 m)</s-button>
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
                            <th style={{ padding: "8px" }}>Show On</th><th style={{ padding: "8px" }}>Sort Order</th><th style={{ padding: "8px" }}>Size Prices (Infinity)</th><th style={{ padding: "8px" }}>Size Prices (Marquee)</th><th style={{ padding: "8px" }}>Size Prices (3D)</th><th style={{ padding: "8px" }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {items.map((item) => (
                            <tr key={item.id} style={{ borderBottom: "1px solid #eee" }}>
                                {editingId === item.id ? (
                                    <td colSpan={9} style={{ padding: "8px" }}>
                                        <fetcher.Form method="post">
                                            <input type="hidden" name="intent" value="update" />
                                            <input type="hidden" name="id" value={item.id} />
                                            <s-stack direction="inline" gap="base">
                                                <input type="text" name="label" defaultValue={item.label} required />
                                                <input type="number" step="0.1" name="heightCm" defaultValue={item.heightCm} required />
                                                <input type="number" step="0.01" name="price" defaultValue={item.price} />
                                                <input type="number" name="sortOrder" defaultValue={item.sortOrder} />
                                                <ShowOnSelect value={item.showOn} />
                                                <label>Infinity <input type="text" name="widthPrices" defaultValue={item.widthPrices} placeholder="100=2620; 150=2840" style={{ minWidth: 340 }} /></label>
                                                <label>Marquee <input type="text" name="marqueeWidthPrices" defaultValue={item.marqueeWidthPrices} placeholder="100=1350; 150=1420" style={{ minWidth: 340 }} /></label>
                                                <label>3D <input type="text" name="sign3dWidthPrices" defaultValue={item.sign3dWidthPrices} placeholder="100=1350; 150=1420" style={{ minWidth: 340 }} /></label>
                                                <s-button type="submit" {...(isSubmitting ? { loading: true } : {})}>Save</s-button>
                                                <s-button variant="tertiary" onClick={() => setEditingId(null)}>Cancel</s-button>
                                            </s-stack>
                                        </fetcher.Form>
                                    </td>
                                ) : (
                                    <>
                                        <td style={{ padding: "8px" }}>{item.label}</td><td style={{ padding: "8px" }}>{item.heightCm}</td><td style={{ padding: "8px" }}>${item.price}</td>
                                        <td style={{ padding: "8px" }}>{SHOWN_ON[item.showOn] || item.showOn}</td><td style={{ padding: "8px" }}>{item.sortOrder}</td>
                                        <td style={{ padding: "8px", fontSize: 12, maxWidth: 380 }}>{item.widthPrices ? readable(item.widthPrices) : "—"}</td>
                                        <td style={{ padding: "8px", fontSize: 12, maxWidth: 380 }}>{item.marqueeWidthPrices ? readable(item.marqueeWidthPrices) : "—"}</td>
                                        <td style={{ padding: "8px", fontSize: 12, maxWidth: 380 }}>{item.sign3dWidthPrices ? readable(item.sign3dWidthPrices) : "—"}</td>
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
