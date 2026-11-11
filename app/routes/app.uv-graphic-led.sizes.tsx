import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

// UV Graphic size prices (uv_size). The storefront size cards always come from Neon Signs → Sizes
// (sign_size, shown on "graphic"); this page only decides their UV price:
//   1. A row here whose Width matches a Neon size (±0.5 cm) overrides that size's price
//      (With Neon = Price, Without Neon = Price Without Neon when filled in).
//   2. Every other size = Neon price + the Default Graphic Surcharge.
//   3. Without Neon Lighting (no own Price Without Neon) = the With Neon price minus the
//      Without Neon Lighting discount (default $100).
// Both settings are stored on the uv_size row with Width 0: price_decimal = surcharge (default
// $50), price_no_led_decimal = Without Neon discount (empty = $100).
// Same rules as sizePrice() in extensions/.../assets/moz-configurator.js — keep both in sync.

const DEFAULT_SURCHARGE = 50;
const DEFAULT_NO_LED_DISCOUNT = 100;
const SURCHARGE_LABEL = "Default Graphic Surcharge";
const WIDTH_TOLERANCE_CM = 0.51;

type Entry = { id: string; label: string; widthCm: string; price: string; priceNoLed: string; sortOrder: string };
type NeonSize = { label: string; widthCm: number; heightCm: number; price: number; sortOrder: number };
type PreviewRow = NeonSize & { withNeon: number; withoutNeon: number; source: string };
type RowStatus = { used: boolean; note: string };

const toNum = (value: unknown) => {
    const n = parseFloat(String(value ?? ""));
    return Number.isFinite(n) ? n : 0;
};

// Same "Show On" rule as the storefront: empty = every configurator, otherwise "graphic" must be listed.
const shownOnGraphic = (showOn: string) => {
    const keys = String(showOn || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    return !keys.length || keys.includes("graphic");
};

async function listUvRows(admin: any): Promise<Entry[]> {
    const response = await admin.graphql(
        `#graphql
    query ListUvSizes { metaobjects(type: "$app:uv_size", first: 250) { edges { node { id fields { key value } } } } }`
    );
    const data = await response.json();
    return (data.data?.metaobjects?.edges || []).map((edge: any) => {
        const f: Record<string, string> = {};
        edge.node.fields.forEach((x: any) => { f[x.key] = x.value; });
        return { id: edge.node.id, label: f.label || "", widthCm: f.width_cm || "0", price: f.price_decimal || "0", priceNoLed: f.price_no_led_decimal || "", sortOrder: f.sort_order || "0" } as Entry;
    });
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { admin } = await authenticate.admin(request);
    const [rows, neonResponse] = await Promise.all([
        listUvRows(admin),
        admin.graphql(
            `#graphql
      query ListNeonSizesForUv { metaobjects(type: "$app:sign_size", first: 250) { edges { node { fields { key value } } } } }`
        ),
    ]);
    const neonData = await neonResponse.json();

    // Rows keep the API (creation) order here — the storefront uses the first matching row.
    const surchargeRow = rows.find((r: Entry) => toNum(r.widthCm) === 0) || null;
    const surcharge = surchargeRow ? toNum(surchargeRow.price) : DEFAULT_SURCHARGE;
    const noLedDiscount = surchargeRow && String(surchargeRow.priceNoLed).trim() !== "" ? Math.max(0, toNum(surchargeRow.priceNoLed)) : DEFAULT_NO_LED_DISCOUNT;
    const overrides = rows.filter((r: Entry) => toNum(r.widthCm) > 0);

    const neonSizes: NeonSize[] = (neonData.data?.metaobjects?.edges || [])
        .map((edge: any, i: number) => {
            const f: Record<string, string> = {};
            edge.node.fields.forEach((x: any) => { f[x.key] = x.value; });
            return { f, i };
        })
        .filter(({ f }: any) => shownOnGraphic(f.show_on))
        .map(({ f, i }: any) => ({
            label: f.label || "",
            widthCm: toNum(f.width_cm),
            heightCm: toNum(f.height_cm),
            price: toNum(f.price_decimal),
            sortOrder: f.sort_order ? toNum(f.sort_order) : 999999,
            index: i,
        }))
        .sort((a: any, b: any) => (a.sortOrder - b.sortOrder) || (a.index - b.index));

    const usedBy: Record<string, string[]> = {};
    const preview: PreviewRow[] = neonSizes.map((s) => {
        const o = overrides.find((r: Entry) => Math.abs(toNum(r.widthCm) - s.widthCm) < WIDTH_TOLERANCE_CM);
        if (o) (usedBy[o.id] = usedBy[o.id] || []).push(s.label);
        const fallback = s.price + surcharge;
        const withNeon = o && toNum(o.price) > 0 ? toNum(o.price) : fallback;
        const withoutNeon = o && toNum(o.priceNoLed) > 0 ? toNum(o.priceNoLed) : Math.max(0, withNeon - noLedDiscount);
        const source = !o
            ? "Neon price + surcharge"
            : toNum(o.price) > 0
                ? `UV price row "${o.label}"`
                : `Row "${o.label}" has no price → Neon price + surcharge`;
        return { ...s, withNeon, withoutNeon, source };
    });

    const status: Record<string, RowStatus> = {};
    overrides.forEach((r: Entry) => {
        const sizes = usedBy[r.id];
        if (sizes?.length) {
            status[r.id] = { used: true, note: "Used for: " + sizes.join(", ") };
        } else {
            const covered = overrides.find((o: Entry) => o.id !== r.id && usedBy[o.id]?.length && Math.abs(toNum(o.widthCm) - toNum(r.widthCm)) < WIDTH_TOLERANCE_CM);
            status[r.id] = {
                used: false,
                note: covered
                    ? `Not used — row "${covered.label}" already covers this width`
                    : "Not used — no Neon size with this width is shown on Graphic",
            };
        }
    });

    const items = overrides.slice().sort((a: Entry, b: Entry) => toNum(a.sortOrder) - toNum(b.sortOrder));
    return { items, status, preview, surcharge, noLedDiscount, hasSurchargeRow: !!surchargeRow };
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const { admin } = await authenticate.admin(request);
    const formData = await request.formData();
    const intent = formData.get("intent");

    if (intent === "save-surcharge") {
        const raw = String(formData.get("surcharge") ?? "").trim();
        const value = parseFloat(raw);
        if (raw === "" || !Number.isFinite(value) || value < 0) return { error: "Enter a surcharge of 0 or more" };
        const offRaw = String(formData.get("noLedDiscount") ?? "").trim();
        const off = parseFloat(offRaw);
        if (offRaw === "" || !Number.isFinite(off) || off < 0) return { error: "Enter a Without Neon Lighting discount of 0 or more" };
        const fields = [
            { key: "label", value: SURCHARGE_LABEL },
            { key: "width_cm", value: "0" },
            { key: "price_decimal", value: value.toFixed(2) },
            { key: "price_no_led_decimal", value: off.toFixed(2) },
            { key: "sort_order", value: "0" },
        ];

        // Self-healing singleton: update the first Width 0 row (the one the storefront reads),
        // create it when missing, and delete accidental duplicates.
        const existing = (await listUvRows(admin)).filter((r: Entry) => toNum(r.widthCm) === 0).map((r: Entry) => r.id);
        if (existing.length === 0) {
            const response = await admin.graphql(
                `#graphql
        mutation CreateSurcharge($metaobject: MetaobjectCreateInput!) {
          metaobjectCreate(metaobject: $metaobject) { metaobject { id } userErrors { field message } }
        }`,
                { variables: { metaobject: { type: "$app:uv_size", fields } } }
            );
            const data = await response.json();
            const errors = data.data?.metaobjectCreate?.userErrors;
            if (errors?.length) return { error: errors[0].message };
            return { success: true };
        }
        const response = await admin.graphql(
            `#graphql
      mutation UpdateSurcharge($id: ID!, $metaobject: MetaobjectUpdateInput!) {
        metaobjectUpdate(id: $id, metaobject: $metaobject) { metaobject { id } userErrors { field message } }
      }`,
            { variables: { id: existing[0], metaobject: { fields } } }
        );
        const data = await response.json();
        const errors = data.data?.metaobjectUpdate?.userErrors;
        if (errors?.length) return { error: errors[0].message };
        for (let i = 1; i < existing.length; i++) {
            await admin.graphql(
                `#graphql
        mutation DeleteSurchargeDuplicate($id: ID!) { metaobjectDelete(id: $id) { deletedId userErrors { field message } } }`,
                { variables: { id: existing[i] } }
            );
        }
        return { success: true };
    }

    if (intent === "create" || intent === "update") {
        const widthCm = parseFloat(String(formData.get("widthCm") || ""));
        const price = parseFloat(String(formData.get("price") || ""));
        if (!Number.isFinite(widthCm) || widthCm <= 0) {
            return { error: "Width must be more than 0 cm (use the Default Graphic Surcharge box for the surcharge)" };
        }
        if (!Number.isFinite(price) || price <= 0) return { error: "Price (With Neon) must be more than 0" };
        const priceNoLedRaw = String(formData.get("priceNoLed") || "").trim();
        const priceNoLed = parseFloat(priceNoLedRaw);
        if (priceNoLedRaw !== "" && (!Number.isFinite(priceNoLed) || priceNoLed <= 0)) {
            return { error: "Price (Without Neon) must be more than 0, or left empty" };
        }

        const fields = [
            { key: "label", value: String(formData.get("label") || "") },
            { key: "width_cm", value: String(widthCm) },
            { key: "price_decimal", value: String(price) },
            { key: "sort_order", value: String(formData.get("sortOrder") || "0") },
        ];
        // Price Without Neon Lighting: optional (empty = With Neon price minus the Without Neon discount). Only sent when
        // filled in, or as "" on update to clear a value that was saved before.
        if (priceNoLedRaw !== "") fields.push({ key: "price_no_led_decimal", value: String(priceNoLed) });
        else if (intent === "update" && formData.get("hadPriceNoLed") === "1") fields.push({ key: "price_no_led_decimal", value: "" });

        if (intent === "create") {
            const response = await admin.graphql(
                `#graphql
        mutation Create($metaobject: MetaobjectCreateInput!) {
          metaobjectCreate(metaobject: $metaobject) { metaobject { id } userErrors { field message } }
        }`,
                { variables: { metaobject: { type: "$app:uv_size", fields } } }
            );
            const data = await response.json();
            const errors = data.data?.metaobjectCreate?.userErrors;
            if (errors?.length) return { error: errors[0].message };
            return { success: true };
        }

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

const money = (value: number) => "$" + value.toFixed(2);

export default function UvSizesPage() {
    const { items, status, preview, surcharge, noLedDiscount, hasSurchargeRow } = useLoaderData<typeof loader>();
    const fetcher = useFetcher<typeof action>();
    const shopify = useAppBridge();
    const [editingId, setEditingId] = useState<string | null>(null);
    const [formKey, setFormKey] = useState(0);
    const isSubmitting = fetcher.state !== "idle";

    useEffect(() => {
        if (fetcher.data && "success" in fetcher.data && fetcher.data.success) {
            shopify.toast.show("Saved successfully");
            setEditingId(null);
            setFormKey((k) => k + 1);
        }
        if (fetcher.data && "error" in fetcher.data && fetcher.data.error) {
            shopify.toast.show(fetcher.data.error, { isError: true });
        }
    }, [fetcher.data, shopify]);

    return (
        <s-page heading="UV Graphic Size Prices">
            <s-section heading="How UV size prices work">
                <s-link href="/app/uv-graphic-led">← Back to UV Graphic Signs</s-link>
                <s-paragraph>
                    The size cards on the Graphic LED &amp; Non-LED storefront come from Neon Signs → Sizes (label, width,
                    height, badge, order). Each card&apos;s price is: the UV price row below with the same width, otherwise
                    the Neon price + the Default Graphic Surcharge. The live preview at the bottom shows the exact result.
                </s-paragraph>
                <s-link href="/app/neon-signs/sizes">Manage Neon Sizes →</s-link>
            </s-section>

            <s-section heading="Default Graphic Surcharge & Without Neon Lighting Discount">
                <s-paragraph>
                    Surcharge: added to the Neon price of every size that has no UV price row below.
                    Without Neon Lighting discount: taken off the With Neon price when the customer chooses
                    Without Neon Lighting (e.g. $649.00 with neon → $549.00 without, for $100). A row below with its
                    own Price (Without Neon) uses that price instead. Both prices are shown live on the storefront
                    Lighting cards.
                    {hasSurchargeRow ? "" : ` Not saved yet — the storefront uses the built-in defaults of ${money(DEFAULT_SURCHARGE)} and ${money(DEFAULT_NO_LED_DISCOUNT)}.`}
                </s-paragraph>
                <fetcher.Form method="post" key={"surcharge" + formKey}>
                    <input type="hidden" name="intent" value="save-surcharge" />
                    <s-stack direction="inline" gap="base">
                        <label>Surcharge ($) <input type="number" step="0.01" min="0" name="surcharge" defaultValue={surcharge} required /></label>
                        <label>Without Neon discount ($) <input type="number" step="0.01" min="0" name="noLedDiscount" defaultValue={noLedDiscount} required /></label>
                        <s-button type="submit" {...(isSubmitting ? { loading: true } : {})}>Save</s-button>
                    </s-stack>
                </fetcher.Form>
            </s-section>

            <s-section heading="Add New UV Price Row">
                <s-paragraph>
                    Width must match a Neon size width (cm). Price Without Neon is optional — empty = With Neon price minus the Without Neon discount.
                </s-paragraph>
                <fetcher.Form method="post" key={"create" + formKey}>
                    <input type="hidden" name="intent" value="create" />
                    <s-stack direction="inline" gap="base">
                        <input type="text" name="label" placeholder="Label (e.g. Medium - 60cm)" required />
                        <input type="number" step="0.1" min="0.1" name="widthCm" placeholder="Width (cm)" required />
                        <input type="number" step="0.01" min="0.01" name="price" placeholder="Price (With Neon)" required />
                        <input type="number" step="0.01" min="0.01" name="priceNoLed" placeholder="Price (Without Neon)" />
                        <input type="number" name="sortOrder" placeholder="Sort Order" defaultValue={items.length + 1} />
                        <s-button type="submit" {...(isSubmitting ? { loading: true } : {})}>Add</s-button>
                    </s-stack>
                </fetcher.Form>
            </s-section>

            <s-section heading={`UV Price Rows (${items.length})`}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                        <tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
                            <th style={{ padding: "8px" }}>Label</th>
                            <th style={{ padding: "8px" }}>Width (cm)</th>
                            <th style={{ padding: "8px" }}>Price (With Neon)</th>
                            <th style={{ padding: "8px" }}>Price (Without Neon)</th>
                            <th style={{ padding: "8px" }}>Sort Order</th>
                            <th style={{ padding: "8px" }}>Status</th>
                            <th style={{ padding: "8px" }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {items.map((item) => (
                            <tr key={item.id} style={{ borderBottom: "1px solid #eee" }}>
                                {editingId === item.id ? (
                                    <td colSpan={7} style={{ padding: "8px" }}>
                                        <fetcher.Form method="post">
                                            <input type="hidden" name="intent" value="update" />
                                            <input type="hidden" name="id" value={item.id} />
                                            <input type="hidden" name="hadPriceNoLed" value={item.priceNoLed ? "1" : "0"} />
                                            <s-stack direction="inline" gap="base">
                                                <input type="text" name="label" defaultValue={item.label} required />
                                                <input type="number" step="0.1" min="0.1" name="widthCm" defaultValue={item.widthCm} required />
                                                <input type="number" step="0.01" min="0.01" name="price" defaultValue={item.price} placeholder="Price (With Neon)" required />
                                                <input type="number" step="0.01" min="0.01" name="priceNoLed" defaultValue={item.priceNoLed} placeholder="Price (Without Neon)" />
                                                <input type="number" name="sortOrder" defaultValue={item.sortOrder} />
                                                <s-button type="submit" {...(isSubmitting ? { loading: true } : {})}>Save</s-button>
                                                <s-button variant="tertiary" onClick={() => setEditingId(null)}>Cancel</s-button>
                                            </s-stack>
                                        </fetcher.Form>
                                    </td>
                                ) : (
                                    <>
                                        <td style={{ padding: "8px" }}>{item.label}</td>
                                        <td style={{ padding: "8px" }}>{item.widthCm}</td>
                                        <td style={{ padding: "8px" }}>${item.price}</td>
                                        <td style={{ padding: "8px" }}>{item.priceNoLed ? `$${item.priceNoLed}` :`With Neon − ${money(noLedDiscount)}`}</td>
                                        <td style={{ padding: "8px" }}>{item.sortOrder}</td>
                                        <td style={{ padding: "8px", color: status[item.id]?.used ? "#0a7d33" : "#b25e00" }}>
                                            {status[item.id]?.used ? "✓ " : "⚠ "}{status[item.id]?.note}
                                            {status[item.id]?.used && Number(item.price) <= 0 ? " (no price set — Neon price + surcharge is used)" : ""}
                                        </td>
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

            <s-section heading={`Live Storefront Preview (${preview.length} sizes)`}>
                <s-paragraph>
                    Exactly what each size card costs on the storefront (size price only — colours, backboards, add-ons etc. are added on top).
                </s-paragraph>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                        <tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
                            <th style={{ padding: "8px" }}>Neon Size</th>
                            <th style={{ padding: "8px" }}>Width (cm)</th>
                            <th style={{ padding: "8px" }}>Neon Price</th>
                            <th style={{ padding: "8px" }}>UV With Neon</th>
                            <th style={{ padding: "8px" }}>UV Without Neon</th>
                            <th style={{ padding: "8px" }}>Price Source</th>
                        </tr>
                    </thead>
                    <tbody>
                        {preview.map((row, i) => (
                            <tr key={row.label + i} style={{ borderBottom: "1px solid #eee" }}>
                                <td style={{ padding: "8px" }}>{row.label}</td>
                                <td style={{ padding: "8px" }}>{row.widthCm}</td>
                                <td style={{ padding: "8px" }}>{money(row.price)}</td>
                                <td style={{ padding: "8px" }}><strong>{money(row.withNeon)}</strong></td>
                                <td style={{ padding: "8px" }}><strong>{money(row.withoutNeon)}</strong></td>
                                <td style={{ padding: "8px", color: "#666" }}>{row.source}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {preview.length === 0 && <s-paragraph>No Neon sizes are shown on Graphic yet — add them under Neon Signs → Sizes.</s-paragraph>}
            </s-section>
        </s-page>
    );
}
