import { useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

type Settings = {
    outdoorSurchargePercent: string;
    outdoorMinimumSurcharge: string;
    includedLettersCount: string;
    panelRatePerSqm: string;
    baseLetterHeightCm: string;
    baseDepthTierLabel: string;
    letterHeightMinCm: string;
    letterHeightMaxCm: string;
    widthMinCm: string;
    widthMaxCm: string;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { admin } = await authenticate.admin(request);
    const response = await admin.graphql(
        `#graphql
    query ListPricingSettings { metaobjects(type: "$app:sign3d_option", first: 100) { edges { node { id fields { key value } } } } }`
    );
    const data = await response.json();
    const all = data.data.metaobjects.edges.map((edge: any) => {
        const f: Record<string, string> = {};
        edge.node.fields.forEach((x: any) => { f[x.key] = x.value; });
        return { id: edge.node.id, ...f };
    });

    const first = all.find((a: any) => a.category === "pricing_settings");
    const settings: Settings = {
        outdoorSurchargePercent: first?.outdoor_surcharge_percent || "15",
        outdoorMinimumSurcharge: first?.outdoor_minimum_surcharge || "200",
        includedLettersCount: first?.included_letters_count || "20",
        panelRatePerSqm: first?.panel_rate_per_sqm || "70",
        baseLetterHeightCm: first?.base_letter_height_cm || "25",
        baseDepthTierLabel: first?.base_depth_tier_label || "",
        letterHeightMinCm: first?.letter_height_min_cm || "",
        letterHeightMaxCm: first?.letter_height_max_cm || "",
        widthMinCm: first?.width_min_cm || "",
        widthMaxCm: first?.width_max_cm || "",
    };
    const hasEntry = !!first;
    return { settings, hasEntry };
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const { admin } = await authenticate.admin(request);
    const formData = await request.formData();

    const fields = [
        { key: "category", value: "pricing_settings" },
        { key: "label", value: "3D Sign Pricing Settings" },
        { key: "outdoor_surcharge_percent", value: String(formData.get("outdoorSurchargePercent") || "15") },
        { key: "outdoor_minimum_surcharge", value: String(formData.get("outdoorMinimumSurcharge") || "200") },
        { key: "included_letters_count", value: String(formData.get("includedLettersCount") || "20") },
        { key: "panel_rate_per_sqm", value: String(formData.get("panelRatePerSqm") || "70") },
        { key: "base_letter_height_cm", value: String(formData.get("baseLetterHeightCm") || "25") },
        { key: "base_depth_tier_label", value: String(formData.get("baseDepthTierLabel") || "") },
    ];
    // Storefront size limits (cm). 0 / empty = previous behaviour (letter height range from the
    // Letter Height tiers, width range from each unit's Min/Max on the Size Units page). Empty
    // inputs are not sent at all (a blank number_decimal value can be rejected by Shopify).
    ([
        ["letter_height_min_cm", "letterHeightMinCm"],
        ["letter_height_max_cm", "letterHeightMaxCm"],
        ["width_min_cm", "widthMinCm"],
        ["width_max_cm", "widthMaxCm"],
    ] as const).forEach(([key, name]) => {
        const value = String(formData.get(name) || "").trim();
        if (value !== "") fields.push({ key, value });
    });

    // Self-healing singleton, same pattern as installation_settings — but filtered by
    // category since pricing_settings shares the sign3d_option metaobject type.
    const response = await admin.graphql(
        `#graphql
    query ListForSave { metaobjects(type: "$app:sign3d_option", first: 100) { edges { node { id fields { key value } } } } }`
    );
    const data = await response.json();
    const existing = data.data.metaobjects.edges
        .filter((edge: any) => edge.node.fields.some((x: any) => x.key === "category" && x.value === "pricing_settings"))
        .map((edge: any) => edge.node.id);

    if (existing.length === 0) {
        const createResponse = await admin.graphql(
            `#graphql
      mutation Create($metaobject: MetaobjectCreateInput!) {
        metaobjectCreate(metaobject: $metaobject) { metaobject { id } userErrors { field message } }
      }`,
            { variables: { metaobject: { type: "$app:sign3d_option", fields } } }
        );
        const createData = await createResponse.json();
        const errors = createData.data?.metaobjectCreate?.userErrors;
        if (errors?.length) return { error: errors[0].message };
        return { success: true };
    }

    const updateResponse = await admin.graphql(
        `#graphql
    mutation Update($id: ID!, $metaobject: MetaobjectUpdateInput!) {
      metaobjectUpdate(id: $id, metaobject: $metaobject) { metaobject { id } userErrors { field message } }
    }`,
        { variables: { id: existing[0], metaobject: { fields } } }
    );
    const updateData = await updateResponse.json();
    const updateErrors = updateData.data?.metaobjectUpdate?.userErrors;
    if (updateErrors?.length) return { error: updateErrors[0].message };

    for (let i = 1; i < existing.length; i++) {
        await admin.graphql(
            `#graphql
      mutation Delete($id: ID!) { metaobjectDelete(id: $id) { deletedId userErrors { field message } } }`,
            { variables: { id: existing[i] } }
        );
    }

    return { success: true };
};

export default function PricingSettingsPage() {
    const { settings, hasEntry } = useLoaderData<typeof loader>();
    const fetcher = useFetcher<typeof action>();
    const shopify = useAppBridge();
    const isSubmitting = fetcher.state !== "idle";

    useEffect(() => {
        if (fetcher.data && "success" in fetcher.data && fetcher.data.success) {
            shopify.toast.show("Saved successfully");
        }
        if (fetcher.data && "error" in fetcher.data && fetcher.data.error) {
            shopify.toast.show(fetcher.data.error, { isError: true });
        }
    }, [fetcher.data, shopify]);

    return (
        <s-page heading="3D Sign Pricing Settings">
            <s-section heading="Global Pricing Rules">
                <s-link href="/app/3d-signs">← Back to 3D Illuminated Signs</s-link>
                <s-paragraph>
                    {hasEntry
                        ? "Controls the Outdoor surcharge, backing panel calculation, included letters, and the base letter height/depth used across the live-measurement pricing engine."
                        : "No entry exists yet — save this form once to create it. Until then, the storefront pricing engine falls back to safe defaults."}
                </s-paragraph>
                <fetcher.Form method="post">
                    <s-stack direction="block" gap="base">
                        <label>
                            Outdoor Surcharge (%)
                            <input type="number" step="0.01" name="outdoorSurchargePercent" defaultValue={settings.outdoorSurchargePercent} required />
                        </label>
                        <label>
                            Outdoor Minimum Surcharge ($)
                            <input type="number" step="0.01" name="outdoorMinimumSurcharge" defaultValue={settings.outdoorMinimumSurcharge} required />
                        </label>
                        <label>
                            Included Letters/Characters Count (Type Wording mode only)
                            <input type="number" name="includedLettersCount" defaultValue={settings.includedLettersCount} required />
                        </label>
                        <label>
                            Backing Panel Rate (per m²)
                            <input type="number" step="0.01" name="panelRatePerSqm" defaultValue={settings.panelRatePerSqm} required />
                        </label>
                        <label>
                            Base Letter Height (cm) — included at $0 (usually 25)
                            <input type="number" step="0.01" name="baseLetterHeightCm" defaultValue={settings.baseLetterHeightCm} required />
                        </label>
                        <label>
                            Base Depth Tier Label — must exactly match a Depth Tier's Label
                            <input type="text" name="baseDepthTierLabel" defaultValue={settings.baseDepthTierLabel} required />
                        </label>
                        <s-heading>Size Limits (storefront)</s-heading>
                        <s-paragraph>
                            Customers cannot go outside these limits — entering a value outside them shows a pop-up with the allowed range.
                            Set a field to 0 to switch that limit off (previous behaviour).
                        </s-paragraph>
                        <label>
                            Letter / Element Height — Minimum (cm), e.g. 10
                            <input type="number" step="0.01" min="0" name="letterHeightMinCm" defaultValue={settings.letterHeightMinCm} />
                        </label>
                        <label>
                            Letter / Element Height — Maximum (cm), e.g. 60
                            <input type="number" step="0.01" min="0" name="letterHeightMaxCm" defaultValue={settings.letterHeightMaxCm} />
                        </label>
                        <label>
                            Overall Sign Width / Length — Minimum (cm), e.g. 50
                            <input type="number" step="0.01" min="0" name="widthMinCm" defaultValue={settings.widthMinCm} />
                        </label>
                        <label>
                            Overall Sign Width / Length — Maximum (cm), e.g. 500 (= 5 metres)
                            <input type="number" step="0.01" min="0" name="widthMaxCm" defaultValue={settings.widthMaxCm} />
                        </label>
                        <s-button type="submit" {...(isSubmitting ? { loading: true } : {})}>Save</s-button>
                    </s-stack>
                </fetcher.Form>
            </s-section>
        </s-page>
    );
}