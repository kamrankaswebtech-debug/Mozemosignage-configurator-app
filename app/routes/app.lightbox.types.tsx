import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

// Lightbox Types (category = "type" in lightbox_option): Slim, Fully Illuminated, Metal-Sided.
// "Lighting" (stored in `sides`, comma separated) = which lighting options the type offers:
// single (single-sided / front-lit), double (double-sided), all (illuminated all around).
type TypeEntry = { id: string; label: string; typeKey: string; description: string; sides: string; extraPrice: string; sortOrder: string };

const TYPE_LABELS: Record<string, string> = { slim: "Slim Lightbox", fully: "Fully Illuminated", metal: "Metal-Sided" };
const SIDES = [
    { value: "single", label: "Single-Sided / Front-Lit" },
    { value: "double", label: "Double-Sided" },
    { value: "all", label: "All-Around" },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { admin } = await authenticate.admin(request);
    const response = await admin.graphql(`#graphql
    query ListLightboxTypes { metaobjects(type: "$app:lightbox_option", first: 100) { edges { node { id fields { key value } } } } }`);
    const data = await response.json();
    const all = data.data.metaobjects.edges.map((edge: any) => {
        const f: Record<string, string> = {};
        edge.node.fields.forEach((x: any) => { f[x.key] = x.value; });
        return {
            id: edge.node.id, label: f.label || "", typeKey: f.type_key || "", description: f.description || "",
            sides: f.sides || "", extraPrice: f.extra_price_decimal || "0", sortOrder: f.sort_order || "0", category: f.category || "",
        };
    });
    const types: TypeEntry[] = all.filter((a: any) => a.category === "type");
    types.sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder));
    return { types };
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const { admin } = await authenticate.admin(request);
    const formData = await request.formData();
    const intent = formData.get("intent");
    const sides = formData.getAll("sides").map(String).filter((s) => ["single", "double", "all"].includes(s));
    const fields = [
        { key: "label", value: String(formData.get("label") || "") },
        { key: "type_key", value: String(formData.get("typeKey") || "slim") },
        { key: "description", value: String(formData.get("description") || "") },
        { key: "sides", value: (sides.length ? sides : ["single"]).join(",") },
        { key: "extra_price_decimal", value: String(formData.get("extraPrice") || "0") },
        { key: "sort_order", value: String(formData.get("sortOrder") || "0") },
        { key: "category", value: "type" },
    ];

    if (intent === "create") {
        const response = await admin.graphql(`#graphql
      mutation CreateLightboxType($metaobject: MetaobjectCreateInput!) { metaobjectCreate(metaobject: $metaobject) { metaobject { id } userErrors { field message } } }`,
            { variables: { metaobject: { type: "$app:lightbox_option", fields } } });
        const data = await response.json();
        const errors = data.data?.metaobjectCreate?.userErrors;
        if (errors?.length) return { error: errors[0].message };
        return { success: true };
    }
    if (intent === "update") {
        const id = String(formData.get("id"));
        const response = await admin.graphql(`#graphql
      mutation UpdateLightboxType($id: ID!, $metaobject: MetaobjectUpdateInput!) { metaobjectUpdate(id: $id, metaobject: $metaobject) { metaobject { id } userErrors { field message } } }`,
            { variables: { id, metaobject: { fields } } });
        const data = await response.json();
        const errors = data.data?.metaobjectUpdate?.userErrors;
        if (errors?.length) return { error: errors[0].message };
        return { success: true };
    }
    if (intent === "delete") {
        const id = String(formData.get("id"));
        const response = await admin.graphql(`#graphql
      mutation DeleteLightboxType($id: ID!) { metaobjectDelete(id: $id) { deletedId userErrors { field message } } }`,
            { variables: { id } });
        const data = await response.json();
        const errors = data.data?.metaobjectDelete?.userErrors;
        if (errors?.length) return { error: errors[0].message };
        return { success: true };
    }
    return { error: "Unknown action" };
};

function TypeFields({ entry, count }: { entry?: TypeEntry; count: number }) {
    const selected = (entry?.sides || "single").split(",");
    return (
        <s-stack direction="inline" gap="base">
            <input type="text" name="label" placeholder="Label (e.g. Slim Lightbox)" defaultValue={entry?.label} required />
            <select name="typeKey" defaultValue={entry?.typeKey || "slim"} required>
                <option value="slim">Slim Lightbox</option>
                <option value="fully">Fully Illuminated</option>
                <option value="metal">Metal-Sided</option>
            </select>
            <input type="text" name="description" placeholder="Short description" defaultValue={entry?.description} style={{ minWidth: 260 }} />
            {SIDES.map((s) => (
                <label key={s.value} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <input type="checkbox" name="sides" value={s.value} defaultChecked={selected.includes(s.value)} /> {s.label}
                </label>
            ))}
            <input type="number" step="0.01" name="extraPrice" placeholder="Extra Price" defaultValue={entry?.extraPrice || "0"} />
            <input type="number" name="sortOrder" placeholder="Sort Order" defaultValue={entry?.sortOrder || count + 1} />
        </s-stack>
    );
}

export default function LightboxTypesPage() {
    const { types } = useLoaderData<typeof loader>();
    const fetcher = useFetcher<typeof action>();
    const shopify = useAppBridge();
    const [editingId, setEditingId] = useState<string | null>(null);
    const isSubmitting = fetcher.state !== "idle";

    useEffect(() => {
        if (fetcher.data && "success" in fetcher.data && fetcher.data.success) { shopify.toast.show("Saved successfully"); setEditingId(null); }
        if (fetcher.data && "error" in fetcher.data && fetcher.data.error) shopify.toast.show(fetcher.data.error, { isError: true });
    }, [fetcher.data, shopify]);

    return (
        <s-page heading="Lightbox Types">
            <s-section heading="Add New Lightbox Type">
                <s-link href="/app/lightbox">← Back to Lightbox Range</s-link>
                <s-paragraph>
                    Recommended set-up: Slim Lightbox (Single-Sided + Double-Sided), Fully Illuminated (All-Around), Metal-Sided
                    (Single-Sided / Front-Lit + Double-Sided). The lighting options ticked here are the ones the customer can choose
                    for that type; prices come from Sizes (one row per type + lighting). With no types added, the storefront
                    uses these three built-in types.
                </s-paragraph>
                <fetcher.Form method="post">
                    <input type="hidden" name="intent" value="create" />
                    <s-stack direction="inline" gap="base">
                        <TypeFields count={types.length} />
                        <s-button type="submit" {...(isSubmitting ? { loading: true } : {})}>Add Type</s-button>
                    </s-stack>
                </fetcher.Form>
            </s-section>

            <s-section heading={`Existing Types (${types.length})`}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                        <tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
                            <th style={{ padding: "8px" }}>Label</th><th style={{ padding: "8px" }}>Type</th><th style={{ padding: "8px" }}>Lighting</th>
                            <th style={{ padding: "8px" }}>Extra Price</th><th style={{ padding: "8px" }}>Sort Order</th><th style={{ padding: "8px" }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {types.map((t) => (
                            <tr key={t.id} style={{ borderBottom: "1px solid #eee" }}>
                                {editingId === t.id ? (
                                    <td colSpan={6} style={{ padding: "8px" }}>
                                        <fetcher.Form method="post">
                                            <input type="hidden" name="intent" value="update" />
                                            <input type="hidden" name="id" value={t.id} />
                                            <s-stack direction="inline" gap="base">
                                                <TypeFields entry={t} count={types.length} />
                                                <s-button type="submit" {...(isSubmitting ? { loading: true } : {})}>Save</s-button>
                                                <s-button variant="tertiary" onClick={() => setEditingId(null)}>Cancel</s-button>
                                            </s-stack>
                                        </fetcher.Form>
                                    </td>
                                ) : (
                                    <>
                                        <td style={{ padding: "8px" }}>{t.label}<br /><small>{t.description}</small></td>
                                        <td style={{ padding: "8px" }}>{TYPE_LABELS[t.typeKey] || t.typeKey}</td>
                                        <td style={{ padding: "8px" }}>{t.sides.split(",").map((s) => SIDES.find((x) => x.value === s)?.label || s).join(", ")}</td>
                                        <td style={{ padding: "8px" }}>${t.extraPrice}</td>
                                        <td style={{ padding: "8px" }}>{t.sortOrder}</td>
                                        <td style={{ padding: "8px" }}>
                                            <s-stack direction="inline" gap="tight">
                                                <s-button variant="tertiary" onClick={() => setEditingId(t.id)}>Edit</s-button>
                                                <fetcher.Form method="post">
                                                    <input type="hidden" name="intent" value="delete" /><input type="hidden" name="id" value={t.id} />
                                                    <s-button variant="tertiary" tone="critical" type="submit" onClick={(e) => { if (!confirm(`Delete "${t.label}"?`)) e.preventDefault(); }}>Delete</s-button>
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
