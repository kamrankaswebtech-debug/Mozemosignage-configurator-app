import { useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

const TOGGLE_KEYS = [
    { key: "choose_size_indoor", label: "Show \"Choose Size\" dropdown — Indoor" },
    { key: "choose_size_outdoor", label: "Show \"Choose Size\" dropdown — Outdoor" },
    { key: "custom_slider_indoor", label: "Show \"Custom Size Slider\" — Indoor" },
    { key: "custom_slider_outdoor", label: "Show \"Custom Size Slider\" — Outdoor" },
] as const;

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { admin } = await authenticate.admin(request);
    const response = await admin.graphql(
        `#graphql
    query ListSizeVisibility {
      metaobjects(type: "$app:signage_addon", first: 100) {
        edges { node { id fields { key value } } }
      }
    }`
    );
    const data = await response.json();
    const all = data.data.metaobjects.edges.map((edge: any) => {
        const f: Record<string, string> = {};
        edge.node.fields.forEach((x: any) => { f[x.key] = x.value; });
        return { id: edge.node.id, category: f.category || "", typeKey: f.type_key || "", isFree: f.is_free === "true" };
    });
    const rows = all.filter((a: any) => a.category === "size_visibility");

    const state: Record<string, boolean> = {};
    TOGGLE_KEYS.forEach((t) => {
        const match = rows.find((r: any) => r.typeKey === t.key);
        // Default to visible (true) when no row exists yet — fully backward compatible.
        state[t.key] = match ? match.isFree : true;
    });

    return { state };
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const { admin } = await authenticate.admin(request);
    const formData = await request.formData();

    // Re-fetch current rows so we can self-heal (update existing, delete duplicates, create missing)
    const response = await admin.graphql(
        `#graphql
    query ListSizeVisibilityForSave {
      metaobjects(type: "$app:signage_addon", first: 100) {
        edges { node { id fields { key value } } }
      }
    }`
    );
    const data = await response.json();
    const all = data.data.metaobjects.edges.map((edge: any) => {
        const f: Record<string, string> = {};
        edge.node.fields.forEach((x: any) => { f[x.key] = x.value; });
        return { id: edge.node.id, category: f.category || "", typeKey: f.type_key || "" };
    });

    for (const t of TOGGLE_KEYS) {
        const isEnabled = formData.get(t.key) === "on";
        const matches = all.filter((r: any) => r.category === "size_visibility" && r.typeKey === t.key);
        const fields = [
            { key: "label", value: t.label },
            { key: "category", value: "size_visibility" },
            { key: "type_key", value: t.key },
            { key: "is_free", value: isEnabled ? "true" : "false" },
            { key: "extra_price_decimal", value: "0" },
            { key: "sort_order", value: "0" },
        ];

        if (matches.length === 0) {
            await admin.graphql(
                `#graphql
        mutation CreateVisibility($metaobject: MetaobjectCreateInput!) {
          metaobjectCreate(metaobject: $metaobject) { metaobject { id } userErrors { field message } }
        }`,
                { variables: { metaobject: { type: "$app:signage_addon", fields } } }
            );
        } else {
            await admin.graphql(
                `#graphql
        mutation UpdateVisibility($id: ID!, $metaobject: MetaobjectUpdateInput!) {
          metaobjectUpdate(id: $id, metaobject: $metaobject) { metaobject { id } userErrors { field message } }
        }`,
                { variables: { id: matches[0].id, metaobject: { fields } } }
            );
            // Self-heal: delete any accidental duplicates beyond the first
            for (let i = 1; i < matches.length; i++) {
                await admin.graphql(
                    `#graphql
          mutation DeleteDupVisibility($id: ID!) {
            metaobjectDelete(id: $id) { deletedId userErrors { field message } }
          }`,
                    { variables: { id: matches[i].id } }
                );
            }
        }
    }

    return { success: true };
};

export default function SizeVisibilityPage() {
    const { state } = useLoaderData<typeof loader>();
    const fetcher = useFetcher<typeof action>();
    const shopify = useAppBridge();
    const isSubmitting = fetcher.state !== "idle";

    useEffect(() => {
        if (fetcher.data && "success" in fetcher.data && fetcher.data.success) {
            shopify.toast.show("Saved successfully");
        }
    }, [fetcher.data, shopify]);

    return (
        <s-page heading="Size Visibility (Indoor / Outdoor)">
            <s-section heading="Control which size options show per Neon Type">
                <s-link href="/app/neon-signs">← Back to Neon Signs</s-link>
                <s-paragraph>
                    Turn each option ON or OFF depending on whether the customer selected Indoor or Outdoor neon type.
                    Everything below is dynamic — changes apply immediately on the storefront.
                </s-paragraph>
                <fetcher.Form method="post">
                    <s-stack direction="block" gap="base">
                        {TOGGLE_KEYS.map((t) => (
                            <label key={t.key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <input type="checkbox" name={t.key} defaultChecked={state[t.key]} />
                                {t.label}
                            </label>
                        ))}
                        <s-button type="submit" {...(isSubmitting ? { loading: true } : {})}>Save</s-button>
                    </s-stack>
                </fetcher.Form>
            </s-section>
        </s-page>
    );
}