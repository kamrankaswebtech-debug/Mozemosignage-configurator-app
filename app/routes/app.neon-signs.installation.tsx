import { useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

type Settings = {
    price: string;
    minLeadDays: string;
    earliestTime: string;
    latestTime: string;
    slotInterval: string;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { admin } = await authenticate.admin(request);
    const response = await admin.graphql(
        `#graphql
    query ListInstallationSettings {
      metaobjects(type: "$app:installation_settings", first: 10) {
        edges { node { id fields { key value } } }
      }
    }`
    );
    const data = await response.json();
    const all = data.data.metaobjects.edges.map((edge: any) => {
        const f: Record<string, string> = {};
        edge.node.fields.forEach((x: any) => { f[x.key] = x.value; });
        return { id: edge.node.id, ...f };
    });

    const first = all[0];
    const settings: Settings = {
        price: first?.price_decimal || "199.99",
        minLeadDays: first?.min_lead_days || "14",
        earliestTime: first?.earliest_time || "10:00",
        latestTime: first?.latest_time || "17:00",
        slotInterval: first?.slot_interval_minutes || "60",
    };
    const hasEntry = all.length > 0;
    return { settings, hasEntry };
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const { admin } = await authenticate.admin(request);
    const formData = await request.formData();

    const fields = [
        { key: "price_decimal", value: String(formData.get("price") || "199.99") },
        { key: "min_lead_days", value: String(formData.get("minLeadDays") || "14") },
        { key: "earliest_time", value: String(formData.get("earliestTime") || "10:00") },
        { key: "latest_time", value: String(formData.get("latestTime") || "17:00") },
        { key: "slot_interval_minutes", value: String(formData.get("slotInterval") || "60") },
    ];

    // Self-healing singleton: re-fetch current entries, update the first one (or create if
    // none exist), and delete any accidental duplicates beyond the first — same proven
    // pattern as neon_size_settings and size_visibility.
    const response = await admin.graphql(
        `#graphql
    query ListForSave {
      metaobjects(type: "$app:installation_settings", first: 10) {
        edges { node { id } }
      }
    }`
    );
    const data = await response.json();
    const existing = data.data.metaobjects.edges.map((edge: any) => edge.node.id);

    if (existing.length === 0) {
        const createResponse = await admin.graphql(
            `#graphql
      mutation Create($metaobject: MetaobjectCreateInput!) {
        metaobjectCreate(metaobject: $metaobject) { metaobject { id } userErrors { field message } }
      }`,
            { variables: { metaobject: { type: "$app:installation_settings", fields } } }
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

export default function InstallationSettingsPage() {
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
        <s-page heading="Installation Option & Booking">
            <s-section heading="Installation Settings">
                <s-link href="/app/neon-signs">← Back to Neon Signs</s-link>
                <s-paragraph>
                    {hasEntry
                        ? "Controls the \"Need Installation?\" section shown on the storefront (LED Neon, UV Graphic LED, UV Print No-LED). Sydney area only, up to 100km, simple wall/ceiling mounting, no electrical work."
                        : "No entry exists yet — save this form once to create it. Until then, the storefront installation section stays hidden."}
                </s-paragraph>
                <fetcher.Form method="post">
                    <s-stack direction="block" gap="base">
                        <label>
                            Installation Price ($)
                            <input type="number" step="0.01" name="price" defaultValue={settings.price} required />
                        </label>
                        <label>
                            Minimum Lead Time (days)
                            <input type="number" name="minLeadDays" defaultValue={settings.minLeadDays} required />
                        </label>
                        <label>
                            Earliest Booking Time (24-hour, e.g. 10:00)
                            <input type="text" name="earliestTime" defaultValue={settings.earliestTime} required />
                        </label>
                        <label>
                            Latest Booking Time (24-hour, e.g. 17:00)
                            <input type="text" name="latestTime" defaultValue={settings.latestTime} required />
                        </label>
                        <label>
                            Time Slot Interval (minutes)
                            <input type="number" name="slotInterval" defaultValue={settings.slotInterval} />
                        </label>
                        <s-button type="submit" {...(isSubmitting ? { loading: true } : {})}>Save</s-button>
                    </s-stack>
                </fetcher.Form>
            </s-section>
        </s-page>
    );
}