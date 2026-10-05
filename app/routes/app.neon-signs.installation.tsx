import { useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
    DEFAULT_BASE_ADDRESS,
    clearInstallationSettingsCache,
    formatBookingDate,
    geocodeAddress,
    isGoogleConfigured,
    sydneyToday,
} from "../utils/installation.server";

type Settings = {
    price: string;
    minLeadDays: string;
    earliestTime: string;
    latestTime: string;
    slotInterval: string;
    baseAddress: string;
    baseLat: string;
    baseLng: string;
    radiusKm: string;
    notifyEmail: string;
    notifyPhone: string;
    holdMinutes: string;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { admin, session } = await authenticate.admin(request);
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
        baseAddress: first?.base_address || DEFAULT_BASE_ADDRESS,
        baseLat: first?.base_lat || "",
        baseLng: first?.base_lng || "",
        radiusKm: first?.service_radius_km || "100",
        notifyEmail: first?.notify_email || "",
        notifyPhone: first?.notify_phone || "+61452086465",
        holdMinutes: first?.hold_minutes || "60",
    };
    const hasEntry = all.length > 0;

    // Upcoming confirmed bookings + active holds. Wrapped so a database outage can never
    // stop the settings form itself from loading.
    let bookings: any[] = [];
    let bookingsError = "";
    try {
        const now = new Date();
        const rows = await db.installationBooking.findMany({
            where: {
                shop: session.shop,
                date: { gte: sydneyToday() },
                OR: [{ status: "CONFIRMED" }, { holdExpiresAt: { gt: now } }],
            },
            orderBy: [{ date: "asc" }, { createdAt: "asc" }],
            take: 200,
        });
        bookings = rows.map((r) => ({
            id: r.id,
            date: r.date,
            dateLabel: formatBookingDate(r.date),
            timeSlot: r.timeSlot,
            status: r.status,
            orderName: r.orderName,
            shopifyOrderId: r.shopifyOrderId,
            customerName: r.customerName,
            customerPhone: r.customerPhone,
            address: r.address,
            distanceKm: r.distanceKm,
            holdExpiresAt: r.holdExpiresAt ? r.holdExpiresAt.toISOString() : null,
        }));
    } catch (err) {
        console.error("Installation bookings load failed:", err);
        bookingsError = "Bookings could not be loaded (database unavailable).";
    }

    const env = {
        google: isGoogleConfigured(),
        email: Boolean(process.env.RESEND_API_KEY),
        sms: Boolean(process.env.CLICKSEND_USERNAME && process.env.CLICKSEND_API_KEY),
    };
    const storeHandle = session.shop.replace(/\.myshopify\.com$/, "");
    return { settings, hasEntry, bookings, bookingsError, env, storeHandle };
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const { admin, session } = await authenticate.admin(request);
    const formData = await request.formData();

    if (formData.get("intent") === "cancel-booking") {
        const id = String(formData.get("id") || "");
        await db.installationBooking.deleteMany({ where: { id, shop: session.shop } });
        return { success: true, message: "Booking removed — the slot is available again" };
    }

    const baseAddress = String(formData.get("baseAddress") || DEFAULT_BASE_ADDRESS).trim();
    let baseLat = String(formData.get("baseLat") || "");
    let baseLng = String(formData.get("baseLng") || "");
    let warning = "";

    // Re-geocode whenever the base address changes (or coordinates are missing) so the
    // 100km check always measures from the real address.
    const previousAddress = String(formData.get("previousBaseAddress") || "");
    if (!baseLat || !baseLng || previousAddress !== baseAddress) {
        const geo = await geocodeAddress(baseAddress);
        if (geo) {
            baseLat = String(geo.lat);
            baseLng = String(geo.lng);
        } else {
            baseLat = "";
            baseLng = "";
            warning = "Saved, but the base address could not be located (check GOOGLE_MAPS_API_KEY). The 100km check will not work until it can.";
        }
    }

    const fields = [
        { key: "price_decimal", value: String(formData.get("price") || "199.99") },
        { key: "min_lead_days", value: String(formData.get("minLeadDays") || "14") },
        { key: "earliest_time", value: String(formData.get("earliestTime") || "10:00") },
        { key: "latest_time", value: String(formData.get("latestTime") || "17:00") },
        { key: "slot_interval_minutes", value: String(formData.get("slotInterval") || "60") },
        { key: "base_address", value: baseAddress },
        { key: "service_radius_km", value: String(parseInt(String(formData.get("radiusKm") || "100"), 10) || 100) },
        { key: "notify_email", value: String(formData.get("notifyEmail") || "").trim() },
        { key: "notify_phone", value: String(formData.get("notifyPhone") || "").trim() },
        { key: "hold_minutes", value: String(parseInt(String(formData.get("holdMinutes") || "60"), 10) || 60) },
        ...(baseLat && baseLng
            ? [{ key: "base_lat", value: baseLat }, { key: "base_lng", value: baseLng }]
            : []),
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

    clearInstallationSettingsCache(session.shop);

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
        return warning ? { error: warning } : { success: true };
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

    return warning ? { error: warning } : { success: true };
};

export default function InstallationSettingsPage() {
    const { settings, hasEntry, bookings, bookingsError, env, storeHandle } = useLoaderData<typeof loader>();
    const fetcher = useFetcher<typeof action>();
    const cancelFetcher = useFetcher<typeof action>();
    const shopify = useAppBridge();
    const isSubmitting = fetcher.state !== "idle";

    useEffect(() => {
        [fetcher.data, cancelFetcher.data].forEach((d: any) => {
            if (!d) return;
            if (d.success) shopify.toast.show(d.message || "Saved successfully");
            if (d.error) shopify.toast.show(d.error, { isError: true });
        });
    }, [fetcher.data, cancelFetcher.data, shopify]);

    const missing = [
        !env.google && "GOOGLE_MAPS_API_KEY (address check / 100km radius)",
        !env.email && "RESEND_API_KEY (email notifications)",
        !env.sms && "CLICKSEND_USERNAME + CLICKSEND_API_KEY (SMS notifications)",
    ].filter(Boolean) as string[];

    return (
        <s-page heading="Installation Option & Booking">
            <s-section heading="Installation Settings">
                <s-link href="/app/neon-signs">← Back to Neon Signs</s-link>
                <s-paragraph>
                    {hasEntry
                        ? "Controls the \"Need Installation?\" section shown on the storefront (LED Neon, UV Graphic LED, UV Print No-LED). Simple wall/ceiling mounting, no electrical work. Each time slot can be booked by only one customer."
                        : "No entry exists yet — save this form once to create it. Until then, the storefront installation section stays hidden."}
                </s-paragraph>
                {missing.length > 0 && (
                    <s-banner tone="warning" heading="Server configuration needed">
                        <s-paragraph>Add these to the app's environment variables: {missing.join(", ")}.</s-paragraph>
                    </s-banner>
                )}
                <fetcher.Form method="post">
                    <input type="hidden" name="previousBaseAddress" value={settings.baseAddress} />
                    <input type="hidden" name="baseLat" value={settings.baseLat} />
                    <input type="hidden" name="baseLng" value={settings.baseLng} />
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
                        <label>
                            Base Address (service area is measured from here)
                            <input type="text" name="baseAddress" defaultValue={settings.baseAddress} required style={{ width: "100%" }} />
                        </label>
                        <s-text color="subdued">
                            {settings.baseLat && settings.baseLng
                                ? `Located at ${Number(settings.baseLat).toFixed(5)}, ${Number(settings.baseLng).toFixed(5)}`
                                : "Not located yet — it will be located automatically when you save."}
                        </s-text>
                        <label>
                            Service Radius (km)
                            <input type="number" name="radiusKm" min="1" defaultValue={settings.radiusKm} required />
                        </label>
                        <label>
                            Notification Email(s) — comma-separated
                            <input type="text" name="notifyEmail" defaultValue={settings.notifyEmail} placeholder="you@example.com" style={{ width: "100%" }} />
                        </label>
                        <label>
                            Notification Phone(s) for SMS — international format, comma-separated
                            <input type="text" name="notifyPhone" defaultValue={settings.notifyPhone} placeholder="+61452086465" style={{ width: "100%" }} />
                        </label>
                        <label>
                            Slot Hold Time (minutes) — how long a selected slot stays reserved before checkout
                            <input type="number" name="holdMinutes" min="5" defaultValue={settings.holdMinutes} />
                        </label>
                        <s-button type="submit" {...(isSubmitting ? { loading: true } : {})}>Save</s-button>
                    </s-stack>
                </fetcher.Form>
            </s-section>

            <s-section heading="Upcoming Installation Bookings">
                {bookingsError ? (
                    <s-paragraph>{bookingsError}</s-paragraph>
                ) : bookings.length === 0 ? (
                    <s-paragraph>No upcoming bookings yet.</s-paragraph>
                ) : (
                    <s-stack direction="block" gap="small-200">
                        {bookings.map((b: any) => (
                            <s-box key={b.id} padding="base" borderWidth="base" borderRadius="base">
                                <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
                                    <s-stack direction="block" gap="small-300">
                                        <s-text type="strong">
                                            {b.dateLabel}, {b.timeSlot} — {b.status === "CONFIRMED" ? "Booked" : "Held (not ordered yet)"}
                                        </s-text>
                                        <s-text color="subdued">
                                            {b.status === "CONFIRMED" ? `${b.orderName || ""} · ${b.customerName || ""}${b.customerPhone ? " · " + b.customerPhone : ""}` : `Reserved until ${b.holdExpiresAt ? new Date(b.holdExpiresAt).toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" }) : ""}`}
                                        </s-text>
                                        <s-text color="subdued">
                                            {b.address || ""}{b.distanceKm != null ? ` (${Number(b.distanceKm).toFixed(1)} km)` : ""}
                                        </s-text>
                                    </s-stack>
                                    <s-stack direction="inline" gap="small-200">
                                        {b.shopifyOrderId && (
                                            <s-button href={`https://admin.shopify.com/store/${storeHandle}/orders/${b.shopifyOrderId}`} target="_blank">View order</s-button>
                                        )}
                                        <cancelFetcher.Form method="post" onSubmit={(e) => { if (!confirm("Remove this booking and make the slot available again?")) e.preventDefault(); }}>
                                            <input type="hidden" name="intent" value="cancel-booking" />
                                            <input type="hidden" name="id" value={b.id} />
                                            <s-button type="submit" tone="critical">Free slot</s-button>
                                        </cancelFetcher.Form>
                                    </s-stack>
                                </s-stack>
                            </s-box>
                        ))}
                    </s-stack>
                )}
            </s-section>
        </s-page>
    );
}
