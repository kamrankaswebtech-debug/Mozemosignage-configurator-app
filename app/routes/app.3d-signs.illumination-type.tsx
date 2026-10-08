import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

type Entry = {
    id: string;
    label: string;
    extraPrice: string;
    sortOrder: string;
    frontFinishes: string[];
    sideFinishes: string[];
    backingFinishes: string[];
};
type Finish = { handle: string; label: string; appliesTo: string[] };

// Finish compatibility per illumination type: which 3D Finishes (Material / Finish page) the
// storefront offers on the Front, Sides and Backing panel. Stored as comma-separated finish
// handles; nothing ticked = every finish for that part (previous behaviour).
const SLOTS = [
    { key: "front", field: "front_finishes", title: "Front" },
    { key: "side", field: "side_finishes", title: "Sides" },
    { key: "backing", field: "backing_finishes", title: "Backing panel" },
] as const;

const splitList = (value: string | undefined) => String(value || "").split(",").map((s) => s.trim()).filter(Boolean);

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { admin } = await authenticate.admin(request);
    const response = await admin.graphql(
        `#graphql
    query List { metaobjects(type: "$app:illumination_type", first: 100) { edges { node { id fields { key value } } } } }`
    );
    const data = await response.json();
    const items: Entry[] = data.data.metaobjects.edges.map((edge: any) => {
        const f: Record<string, string> = {};
        edge.node.fields.forEach((x: any) => { f[x.key] = x.value; });
        return {
            id: edge.node.id,
            label: f.label || "",
            extraPrice: f.extra_price_decimal || "0",
            sortOrder: f.sort_order || "0",
            frontFinishes: splitList(f.front_finishes),
            sideFinishes: splitList(f.side_finishes),
            backingFinishes: splitList(f.backing_finishes),
        };
    });
    items.sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder));

    const finishRes = await admin.graphql(
        `#graphql
    query Finishes { metaobjects(type: "$app:sign3d_option", first: 250) { edges { node { handle fields { key value } } } } }`
    );
    const finishData = await finishRes.json();
    const finishes: Finish[] = finishData.data.metaobjects.edges
        .map((edge: any) => {
            const f: Record<string, string> = {};
            edge.node.fields.forEach((x: any) => { f[x.key] = x.value; });
            const applies = splitList(f.finish_applies_to);
            return {
                handle: edge.node.handle || "",
                label: f.label || "",
                category: f.category || "",
                sort: Number(f.sort_order || 0),
                appliesTo: applies.length ? applies : ["front", "side"],
            };
        })
        .filter((x: any) => x.category === "finish")
        .sort((a: any, b: any) => a.sort - b.sort)
        .map((x: any) => ({ handle: x.handle, label: x.label, appliesTo: x.appliesTo }));

    return { items, finishes };
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const { admin } = await authenticate.admin(request);
    const formData = await request.formData();
    const intent = formData.get("intent");
    const fields = [
        { key: "label", value: String(formData.get("label") || "") },
        { key: "extra_price_decimal", value: String(formData.get("extraPrice") || "0") },
        { key: "sort_order", value: String(formData.get("sortOrder") || "0") },
    ];
    // Finish checkboxes are only part of the edit form, so a plain create keeps them empty (= all).
    if (formData.get("hasFinishFields") === "1") {
        SLOTS.forEach((slot) => {
            const handles = formData.getAll(slot.field).map((v) => String(v)).filter(Boolean);
            fields.push({ key: slot.field, value: handles.join(",") });
        });
    }

    if (intent === "create") {
        const response = await admin.graphql(
            `#graphql
      mutation Create($metaobject: MetaobjectCreateInput!) {
        metaobjectCreate(metaobject: $metaobject) { metaobject { id } userErrors { field message } }
      }`,
            { variables: { metaobject: { type: "$app:illumination_type", fields } } }
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

function finishSummary(handles: string[], finishes: Finish[], slot: string) {
    if (!handles.length) return "All";
    const names = handles.map((h) => finishes.find((f) => f.handle === h)?.label).filter(Boolean);
    const offered = finishes.filter((f) => f.appliesTo.includes(slot)).length;
    return names.length ? names.join(", ") : (offered ? "All" : "—");
}

export default function IlluminationTypePage() {
    const { items, finishes } = useLoaderData<typeof loader>();
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

    const slotValues = (item: Entry, key: string) =>
        key === "front" ? item.frontFinishes : key === "side" ? item.sideFinishes : item.backingFinishes;

    return (
        <s-page heading="Illumination Type">
            <s-section heading="Add New Illumination Type">
                <s-link href="/app/3d-signs">← Back to 3D Illuminated Signs</s-link>
                <fetcher.Form method="post">
                    <input type="hidden" name="intent" value="create" />
                    <s-stack direction="inline" gap="base">
                        <input type="text" name="label" placeholder="Label (e.g. Backlit)" required />
                        <input type="number" step="0.01" name="extraPrice" placeholder="Extra Price" defaultValue="0" />
                        <input type="number" name="sortOrder" placeholder="Sort Order" defaultValue={items.length + 1} />
                        <s-button type="submit" {...(isSubmitting ? { loading: true } : {})}>Add</s-button>
                    </s-stack>
                </fetcher.Form>
            </s-section>

            <s-section heading="Material / Finish compatibility">
                <s-paragraph>
                    Click Edit on an illumination type to choose which finishes the customer may pick for the Front, the Sides and the
                    Backing panel when that type is selected (e.g. Frontlit: Front = Gloss Acrylic only). Nothing ticked = all finishes
                    offered for that part. Finishes are managed on the Material / Finish page.
                </s-paragraph>
            </s-section>

            <s-section heading={`Existing (${items.length})`}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                        <tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
                            <th style={{ padding: "8px" }}>Label</th>
                            <th style={{ padding: "8px" }}>Extra Price</th>
                            <th style={{ padding: "8px" }}>Sort Order</th>
                            <th style={{ padding: "8px" }}>Front</th>
                            <th style={{ padding: "8px" }}>Sides</th>
                            <th style={{ padding: "8px" }}>Backing</th>
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
                                            <input type="hidden" name="hasFinishFields" value="1" />
                                            <s-stack direction="block" gap="base">
                                                <s-stack direction="inline" gap="base">
                                                    <input type="text" name="label" defaultValue={item.label} required />
                                                    <input type="number" step="0.01" name="extraPrice" defaultValue={item.extraPrice} />
                                                    <input type="number" name="sortOrder" defaultValue={item.sortOrder} />
                                                </s-stack>
                                                {SLOTS.map((slot) => {
                                                    const offered = finishes.filter((f) => f.appliesTo.includes(slot.key));
                                                    const current = slotValues(item, slot.key);
                                                    return (
                                                        <div key={slot.key}>
                                                            <strong>{slot.title}:</strong>{" "}
                                                            {offered.length ? offered.map((f) => (
                                                                <label key={f.handle} style={{ marginRight: 14, display: "inline-flex", gap: 4, alignItems: "center" }}>
                                                                    <input type="checkbox" name={slot.field} value={f.handle} defaultChecked={current.includes(f.handle)} />
                                                                    {f.label}
                                                                </label>
                                                            )) : <em>No finishes are set to show under "{slot.title}" yet (Material / Finish page).</em>}
                                                        </div>
                                                    );
                                                })}
                                                <s-stack direction="inline" gap="base">
                                                    <s-button type="submit" {...(isSubmitting ? { loading: true } : {})}>Save</s-button>
                                                    <s-button variant="tertiary" onClick={() => setEditingId(null)}>Cancel</s-button>
                                                </s-stack>
                                            </s-stack>
                                        </fetcher.Form>
                                    </td>
                                ) : (
                                    <>
                                        <td style={{ padding: "8px" }}>{item.label}</td>
                                        <td style={{ padding: "8px" }}>${item.extraPrice}</td>
                                        <td style={{ padding: "8px" }}>{item.sortOrder}</td>
                                        {SLOTS.map((slot) => (
                                            <td key={slot.key} style={{ padding: "8px" }}>{finishSummary(slotValues(item, slot.key), finishes, slot.key)}</td>
                                        ))}
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
