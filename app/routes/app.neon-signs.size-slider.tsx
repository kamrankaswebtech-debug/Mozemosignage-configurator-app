import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

type UnitEntry = {
    id: string;
    unit: string;
    minValue: string;
    maxValue: string;
    pricePerUnit: string;
    heightRatio: string;
    sortOrder: string;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { admin } = await authenticate.admin(request);
    const response = await admin.graphql(
        `#graphql
    query ListSizeUnits {
      metaobjects(type: "$app:neon_size_settings", first: 100) {
        edges { node { id fields { key value } } }
      }
    }`
    );
    const data = await response.json();
    const units: UnitEntry[] = data.data.metaobjects.edges.map((edge: any) => {
        const f: Record<string, string> = {};
        edge.node.fields.forEach((x: any) => { f[x.key] = x.value; });
        return {
            id: edge.node.id,
            unit: f.unit || "cm",
            minValue: f.min_value || "0",
            maxValue: f.max_value || "100",
            pricePerUnit: f.price_per_unit || "0",
            heightRatio: f.height_ratio || "2.6",
            sortOrder: f.sort_order || "0",
        };
    });
    units.sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder));
    return { units };
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const { admin } = await authenticate.admin(request);
    const formData = await request.formData();
    const intent = formData.get("intent");

    const fields = [
        { key: "unit", value: String(formData.get("unit") || "cm") },
        { key: "min_value", value: String(formData.get("minValue") || "0") },
        { key: "max_value", value: String(formData.get("maxValue") || "100") },
        { key: "price_per_unit", value: String(formData.get("pricePerUnit") || "0") },
        { key: "height_ratio", value: String(formData.get("heightRatio") || "2.6") },
        { key: "sort_order", value: String(formData.get("sortOrder") || "0") },
    ];

    if (intent === "create") {
        const response = await admin.graphql(
            `#graphql
      mutation CreateSizeUnit($metaobject: MetaobjectCreateInput!) {
        metaobjectCreate(metaobject: $metaobject) {
          metaobject { id }
          userErrors { field message }
        }
      }`,
            { variables: { metaobject: { type: "$app:neon_size_settings", fields } } }
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
      mutation UpdateSizeUnit($id: ID!, $metaobject: MetaobjectUpdateInput!) {
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
      mutation DeleteSizeUnit($id: ID!) {
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

export default function SizeUnitsPage() {
    const { units } = useLoaderData<typeof loader>();
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
        <s-page heading="Custom Size Slider — Units">
            <s-section heading="Add New Unit">
                <s-link href="/app/neon-signs">← Back to Neon Signs</s-link>
                <s-paragraph>
                    Each unit shown here becomes a clickable tab on the storefront's custom size slider (e.g. CM, MM, INCH, FT).
                    Add as many units as you like — the lowest Sort Order appears first and is the default shown to customers
                    (make your "cm" entry Sort Order 1, since it should be the main unit).
                </s-paragraph>
                <fetcher.Form method="post">
                    <input type="hidden" name="intent" value="create" />
                    <s-stack direction="inline" gap="base">
                        <input type="text" name="unit" placeholder="Unit (e.g. cm, inch, ft)" required />
                        <input type="number" step="0.1" name="minValue" placeholder="Min" required />
                        <input type="number" step="0.1" name="maxValue" placeholder="Max" required />
                        <input type="number" step="0.01" name="pricePerUnit" placeholder="Price per unit ($)" required />
                        <input type="number" step="0.1" name="heightRatio" placeholder="Height Ratio" defaultValue="2.6" required />
                        <input type="number" name="sortOrder" placeholder="Sort Order" defaultValue={units.length + 1} />
                        <s-button type="submit" {...(isSubmitting ? { loading: true } : {})}>Add Unit</s-button>
                    </s-stack>
                </fetcher.Form>
            </s-section>

            <s-section heading={`Existing Units (${units.length})`}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                        <tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
                            <th style={{ padding: "8px" }}>Unit</th>
                            <th style={{ padding: "8px" }}>Min</th>
                            <th style={{ padding: "8px" }}>Max</th>
                            <th style={{ padding: "8px" }}>Price/Unit</th>
                            <th style={{ padding: "8px" }}>Height Ratio</th>
                            <th style={{ padding: "8px" }}>Sort Order</th>
                            <th style={{ padding: "8px" }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {units.map((u) => (
                            <tr key={u.id} style={{ borderBottom: "1px solid #eee" }}>
                                {editingId === u.id ? (
                                    <td colSpan={7} style={{ padding: "8px" }}>
                                        <fetcher.Form method="post">
                                            <input type="hidden" name="intent" value="update" />
                                            <input type="hidden" name="id" value={u.id} />
                                            <s-stack direction="inline" gap="base">
                                                <input type="text" name="unit" defaultValue={u.unit} required />
                                                <input type="number" step="0.1" name="minValue" defaultValue={u.minValue} required />
                                                <input type="number" step="0.1" name="maxValue" defaultValue={u.maxValue} required />
                                                <input type="number" step="0.01" name="pricePerUnit" defaultValue={u.pricePerUnit} required />
                                                <input type="number" step="0.1" name="heightRatio" defaultValue={u.heightRatio} required />
                                                <input type="number" name="sortOrder" defaultValue={u.sortOrder} />
                                                <s-button type="submit" {...(isSubmitting ? { loading: true } : {})}>Save</s-button>
                                                <s-button variant="tertiary" onClick={() => setEditingId(null)}>Cancel</s-button>
                                            </s-stack>
                                        </fetcher.Form>
                                    </td>
                                ) : (
                                    <>
                                        <td style={{ padding: "8px" }}>{u.unit}</td>
                                        <td style={{ padding: "8px" }}>{u.minValue}</td>
                                        <td style={{ padding: "8px" }}>{u.maxValue}</td>
                                        <td style={{ padding: "8px" }}>${u.pricePerUnit}</td>
                                        <td style={{ padding: "8px" }}>{u.heightRatio}</td>
                                        <td style={{ padding: "8px" }}>{u.sortOrder}</td>
                                        <td style={{ padding: "8px" }}>
                                            <s-stack direction="inline" gap="tight">
                                                <s-button variant="tertiary" onClick={() => setEditingId(u.id)}>Edit</s-button>
                                                <fetcher.Form method="post">
                                                    <input type="hidden" name="intent" value="delete" />
                                                    <input type="hidden" name="id" value={u.id} />
                                                    <s-button variant="tertiary" tone="critical" type="submit"
                                                        onClick={(e) => { if (!confirm(`Delete unit "${u.unit}"?`)) e.preventDefault(); }}>
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