import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

type StyleEntry = {
    id: string;
    label: string;
    shapeType: string;
    extraPrice: string;
    sortOrder: string;
    visibility: string;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { admin } = await authenticate.admin(request);
    const response = await admin.graphql(
        `#graphql
    query ListBackboardStyles {
      metaobjects(type: "$app:backboard_style", first: 100) {
        edges { node { id fields { key value } } }
      }
    }`
    );
    const data = await response.json();
    const styles: StyleEntry[] = data.data.metaobjects.edges.map((edge: any) => {
        const f: Record<string, string> = {};
        edge.node.fields.forEach((x: any) => { f[x.key] = x.value; });
        return {
            id: edge.node.id,
            label: f.label || "",
            shapeType: f.shape_type || "rectangle",
            extraPrice: f.extra_price_decimal || "0",
            sortOrder: f.sort_order || "0",
            visibility: f.visibility || "both",
        };
    });
    styles.sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder));
    return { styles };
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const { admin } = await authenticate.admin(request);
    const formData = await request.formData();
    const intent = formData.get("intent");

    const fields = [
        { key: "label", value: String(formData.get("label") || "") },
        { key: "shape_type", value: String(formData.get("shapeType") || "rectangle") },
        { key: "extra_price_decimal", value: String(formData.get("extraPrice") || "0") },
        { key: "sort_order", value: String(formData.get("sortOrder") || "0") },
        { key: "visibility", value: String(formData.get("visibility") || "both") },
    ];

    if (intent === "create") {
        const response = await admin.graphql(
            `#graphql
      mutation CreateBackboardStyle($metaobject: MetaobjectCreateInput!) {
        metaobjectCreate(metaobject: $metaobject) {
          metaobject { id }
          userErrors { field message }
        }
      }`,
            { variables: { metaobject: { type: "$app:backboard_style", fields } } }
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
      mutation UpdateBackboardStyle($id: ID!, $metaobject: MetaobjectUpdateInput!) {
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
      mutation DeleteBackboardStyle($id: ID!) {
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

export default function BackboardStylesPage() {
    const { styles } = useLoaderData<typeof loader>();
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
        <s-page heading="Backboard Styles">
            <s-section heading="Add New Style">
                <s-link href="/app/neon-signs">← Back to Neon Signs</s-link>
                <fetcher.Form method="post">
                    <input type="hidden" name="intent" value="create" />
                    <s-stack direction="inline" gap="base">
                        <input type="text" name="label" placeholder="Label (e.g. Cut Around)" required />
                        <select name="shapeType" defaultValue="rectangle" required>
                            <option value="rectangle">Rectangle</option>
                            <option value="cut-around">Cut Around</option>
                            <option value="cut-to-letter">Cut to Letter</option>
                            <option value="naked">Naked (No Backboard)</option>
                        </select>
                        <input type="number" step="0.01" name="extraPrice" placeholder="Extra Price" defaultValue="0" />
                        <input type="number" name="sortOrder" placeholder="Sort Order" defaultValue={styles.length + 1} />
                        <select name="visibility" defaultValue="both">
                            <option value="both">Both (Neon + 3D)</option>
                            <option value="neon_only">Neon Only</option>
                            <option value="3d_only">3D Only</option>
                        </select>
                        <s-button type="submit" {...(isSubmitting ? { loading: true } : {})}>Add Style</s-button>
                    </s-stack>
                </fetcher.Form>
            </s-section>

            <s-section heading={`Existing Styles (${styles.length})`}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                        <tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
                            <th style={{ padding: "8px" }}>Label</th>
                            <th style={{ padding: "8px" }}>Shape Type</th>
                            <th style={{ padding: "8px" }}>Extra Price</th>
                            <th style={{ padding: "8px" }}>Sort Order</th>
                            <th style={{ padding: "8px" }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {styles.map((s) => (
                            <tr key={s.id} style={{ borderBottom: "1px solid #eee" }}>
                                {editingId === s.id ? (
                                    <td colSpan={5} style={{ padding: "8px" }}>
                                        <fetcher.Form method="post">
                                            <input type="hidden" name="intent" value="update" />
                                            <input type="hidden" name="id" value={s.id} />
                                            <s-stack direction="inline" gap="base">
                                                <input type="text" name="label" defaultValue={s.label} required />
                                                <select name="shapeType" defaultValue={s.shapeType} required>
                                                    <option value="rectangle">Rectangle</option>
                                                    <option value="cut-around">Cut Around</option>
                                                    <option value="cut-to-letter">Cut to Letter</option>
                                                    <option value="naked">Naked (No Backboard)</option>
                                                </select>
                                                <input type="number" step="0.01" name="extraPrice" defaultValue={s.extraPrice} />
                                                <input type="number" name="sortOrder" defaultValue={s.sortOrder} />
                                                <select name="visibility" defaultValue={s.visibility}>
                                                    <option value="both">Both (Neon + 3D)</option>
                                                    <option value="neon_only">Neon Only</option>
                                                    <option value="3d_only">3D Only</option>
                                                </select>
                                                <s-button type="submit" {...(isSubmitting ? { loading: true } : {})}>Save</s-button>
                                                <s-button variant="tertiary" onClick={() => setEditingId(null)}>Cancel</s-button>
                                            </s-stack>
                                        </fetcher.Form>
                                    </td>
                                ) : (
                                    <>
                                        <td style={{ padding: "8px" }}>{s.label}</td>
                                        <td style={{ padding: "8px" }}>{s.shapeType}</td>
                                        <td style={{ padding: "8px" }}>${s.extraPrice}</td>
                                        <td style={{ padding: "8px" }}>{s.sortOrder}</td>
                                        <td style={{ padding: "8px" }}>
                                            <s-stack direction="inline" gap="tight">
                                                <s-button variant="tertiary" onClick={() => setEditingId(s.id)}>Edit</s-button>
                                                <fetcher.Form method="post">
                                                    <input type="hidden" name="intent" value="delete" />
                                                    <input type="hidden" name="id" value={s.id} />
                                                    <s-button variant="tertiary" tone="critical" type="submit"
                                                        onClick={(e) => { if (!confirm(`Delete style "${s.label}"?`)) e.preventDefault(); }}>
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