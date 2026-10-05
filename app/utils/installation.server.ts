// Shared server logic for the Installation booking system (LED Neon, UV Graphic LED,
// UV Print No-LED). Used by the storefront app-proxy route, the orders webhooks and the
// Admin installation settings page so every part uses the exact same rules.
import db from "../db.server";
import { Resend } from "resend";

export const DEFAULT_BASE_ADDRESS = "81 Clare Street, Blacktown NSW 2148";

export type InstallationSettings = {
    id: string | null;
    price: string;
    minLeadDays: number;
    earliestTime: string;
    latestTime: string;
    slotInterval: number;
    baseAddress: string;
    baseLat: number | null;
    baseLng: number | null;
    radiusKm: number;
    notifyEmail: string;
    notifyPhone: string;
    holdMinutes: number;
};

type AdminLike = { graphql: (query: string, options?: any) => Promise<Response> };

const settingsCache = new Map<string, { at: number; value: InstallationSettings }>();
const SETTINGS_TTL_MS = 60 * 1000;

function toNumber(value: unknown, fallback: number): number {
    const n = parseFloat(String(value ?? ""));
    return Number.isFinite(n) ? n : fallback;
}

export function parseInstallationSettings(id: string | null, f: Record<string, string>): InstallationSettings {
    const lat = parseFloat(f.base_lat ?? "");
    const lng = parseFloat(f.base_lng ?? "");
    return {
        id,
        price: f.price_decimal || "199.99",
        minLeadDays: toNumber(f.min_lead_days, 14),
        earliestTime: f.earliest_time || "10:00",
        latestTime: f.latest_time || "17:00",
        slotInterval: toNumber(f.slot_interval_minutes, 60) || 60,
        baseAddress: f.base_address || DEFAULT_BASE_ADDRESS,
        baseLat: Number.isFinite(lat) ? lat : null,
        baseLng: Number.isFinite(lng) ? lng : null,
        radiusKm: toNumber(f.service_radius_km, 100) || 100,
        notifyEmail: f.notify_email || "",
        notifyPhone: f.notify_phone || "",
        holdMinutes: toNumber(f.hold_minutes, 60) || 60,
    };
}

export async function getInstallationSettings(admin: AdminLike, shop: string, fresh = false): Promise<InstallationSettings | null> {
    const cached = settingsCache.get(shop);
    if (!fresh && cached && Date.now() - cached.at < SETTINGS_TTL_MS) return cached.value;

    const response = await admin.graphql(
        `#graphql
    query InstallationSettingsForBooking {
      metaobjects(type: "$app:installation_settings", first: 1) {
        edges { node { id fields { key value } } }
      }
    }`,
    );
    const data: any = await response.json();
    const node = data?.data?.metaobjects?.edges?.[0]?.node;
    if (!node) return null;
    const f: Record<string, string> = {};
    node.fields.forEach((x: any) => { f[x.key] = x.value; });
    const value = parseInstallationSettings(node.id, f);

    // Base coordinates are normally saved by the Admin settings page. If they are missing
    // (e.g. settings were never re-saved after this feature shipped), geocode once and cache.
    if (value.baseLat === null || value.baseLng === null) {
        const geo = await geocodeAddress(value.baseAddress);
        if (geo) {
            value.baseLat = geo.lat;
            value.baseLng = geo.lng;
        }
    }

    settingsCache.set(shop, { at: Date.now(), value });
    return value;
}

export function clearInstallationSettingsCache(shop: string) {
    settingsCache.delete(shop);
}

// Same slot list + label format the storefront builds (e.g. "10:00 AM"), so a slot sent
// by the browser can be validated against the real configured list.
export function generateTimeSlots(earliest: string, latest: string, interval: number): string[] {
    const [startH, startM] = earliest.split(":").map(Number);
    const [endH, endM] = latest.split(":").map(Number);
    const start = (startH || 0) * 60 + (startM || 0);
    const end = (endH || 0) * 60 + (endM || 0);
    const step = interval > 0 ? interval : 60;
    const slots: string[] = [];
    for (let m = start; m <= end; m += step) {
        const h24 = Math.floor(m / 60);
        const mm = m % 60;
        const period = h24 >= 12 ? "PM" : "AM";
        const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
        slots.push(h12 + ":" + String(mm).padStart(2, "0") + " " + period);
    }
    return slots;
}

export function sydneyToday(): string {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney" }).format(new Date());
}

export function addDaysIso(iso: string, days: number): string {
    const d = new Date(iso + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

export function isValidIsoDate(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const d = new Date(value + "T00:00:00Z");
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

// The storefront computes its minimum date in the customer's browser; allow one day of
// leeway so a timezone difference can never wrongly reject a valid booking.
export function isDateBookable(date: string, settings: InstallationSettings): boolean {
    if (!isValidIsoDate(date)) return false;
    const earliest = addDaysIso(sydneyToday(), Math.max(0, settings.minLeadDays - 1));
    return date >= earliest;
}

export function formatBookingDate(iso: string): string {
    if (!isValidIsoDate(iso)) return iso;
    return new Intl.DateTimeFormat("en-AU", {
        weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
    }).format(new Date(iso + "T00:00:00Z"));
}

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
}

// ---------------- Google Maps (server-side only — the API key never reaches the browser) ----------------

function googleKey(): string {
    return process.env.GOOGLE_MAPS_API_KEY || "";
}

export function isGoogleConfigured(): boolean {
    return Boolean(googleKey());
}

export async function geocodeAddress(address: string): Promise<{ lat: number; lng: number; formattedAddress: string } | null> {
    if (!googleKey() || !address) return null;
    try {
        const url = "https://maps.googleapis.com/maps/api/geocode/json?region=au&address=" +
            encodeURIComponent(address) + "&key=" + encodeURIComponent(googleKey());
        const res = await fetch(url);
        const data: any = await res.json();
        const first = data?.results?.[0];
        if (!first) {
            console.error("Installation: geocode returned no result", data?.status, data?.error_message);
            return null;
        }
        return {
            lat: first.geometry.location.lat,
            lng: first.geometry.location.lng,
            formattedAddress: first.formatted_address,
        };
    } catch (err) {
        console.error("Installation: geocode failed", err);
        return null;
    }
}

export async function autocompleteAddress(input: string, sessionToken: string, bias: { lat: number; lng: number } | null) {
    if (!googleKey()) return [];
    const body: any = { input, includedRegionCodes: ["au"] };
    if (sessionToken) body.sessionToken = sessionToken;
    if (bias) body.locationBias = { circle: { center: { latitude: bias.lat, longitude: bias.lng }, radius: 50000 } };
    const res = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Goog-Api-Key": googleKey() },
        body: JSON.stringify(body),
    });
    const data: any = await res.json();
    if (!res.ok) {
        console.error("Installation: Places autocomplete error", data?.error?.message || res.status);
        return [];
    }
    return (data?.suggestions || [])
        .map((s: any) => s.placePrediction)
        .filter(Boolean)
        .slice(0, 5)
        .map((p: any) => ({
            placeId: p.placeId,
            text: p.text?.text || "",
            main: p.structuredFormat?.mainText?.text || p.text?.text || "",
            secondary: p.structuredFormat?.secondaryText?.text || "",
        }));
}

export async function placeDetails(placeId: string, sessionToken: string): Promise<{ lat: number; lng: number; formattedAddress: string } | null> {
    if (!googleKey() || !/^[A-Za-z0-9_-]+$/.test(placeId)) return null;
    const url = "https://places.googleapis.com/v1/places/" + placeId +
        (sessionToken ? "?sessionToken=" + encodeURIComponent(sessionToken) : "");
    const res = await fetch(url, {
        headers: { "X-Goog-Api-Key": googleKey(), "X-Goog-FieldMask": "formattedAddress,location" },
    });
    const data: any = await res.json();
    if (!res.ok || !data?.location) {
        console.error("Installation: place details error", data?.error?.message || res.status);
        return null;
    }
    return { lat: data.location.latitude, lng: data.location.longitude, formattedAddress: data.formattedAddress || "" };
}

// ---------------- Booking (hold / availability / confirm) ----------------

function activeWhere(now: Date) {
    return { OR: [{ status: "CONFIRMED" }, { holdExpiresAt: { gt: now } }] };
}

export async function getBookedSlots(shop: string, date: string, ownToken: string): Promise<string[]> {
    const now = new Date();
    const rows = await db.installationBooking.findMany({
        where: { shop, date, ...activeWhere(now), ...(ownToken ? { NOT: { holdToken: ownToken } } : {}) },
        select: { timeSlot: true },
    });
    return rows.map((r) => r.timeSlot);
}

export async function holdSlot(args: {
    shop: string; token: string; date: string; slot: string;
    address: string; distanceKm: number | null; holdMinutes: number;
}): Promise<{ ok: true; expiresAt: string } | { ok: false; reason: "taken" }> {
    const { shop, token, date, slot } = args;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + args.holdMinutes * 60 * 1000);
    try {
        await db.$transaction(async (tx) => {
            // Free this slot if its previous hold has already expired.
            await tx.installationBooking.deleteMany({
                where: { shop, date, timeSlot: slot, status: "HOLD", holdExpiresAt: { lt: now } },
            });
            const existing = await tx.installationBooking.findUnique({
                where: { shop_date_timeSlot: { shop, date, timeSlot: slot } },
            });
            if (existing && existing.holdToken !== token) throw new SlotTakenError();

            // A customer switching to a different slot releases their previous hold.
            await tx.installationBooking.deleteMany({
                where: { holdToken: token, status: "HOLD", NOT: { date, timeSlot: slot } },
            });

            if (existing) {
                await tx.installationBooking.update({
                    where: { id: existing.id },
                    data: { holdExpiresAt: expiresAt, address: args.address, distanceKm: args.distanceKm },
                });
            } else {
                await tx.installationBooking.create({
                    data: {
                        shop, date, timeSlot: slot, status: "HOLD", holdToken: token,
                        holdExpiresAt: expiresAt, address: args.address, distanceKm: args.distanceKm,
                    },
                });
            }
        });
        return { ok: true, expiresAt: expiresAt.toISOString() };
    } catch (err: any) {
        // P2002 = unique constraint: another customer grabbed this exact slot at the same moment.
        if (err instanceof SlotTakenError || err?.code === "P2002") return { ok: false, reason: "taken" };
        throw err;
    }
}

export async function releaseHold(token: string) {
    if (!token) return;
    await db.installationBooking.deleteMany({ where: { holdToken: token, status: "HOLD" } });
}

class SlotTakenError extends Error {}

export type ConfirmResult =
    | { status: "confirmed" | "already"; bookingId: string; notifiedAt: Date | null }
    | { status: "conflict"; conflictOrderName: string | null };

// Called from the orders/create webhook. A placed order always wins over a mere storefront
// hold; only an existing CONFIRMED booking from a different order is a real conflict.
export async function confirmBooking(args: {
    shop: string; token: string; date: string; slot: string; orderId: string; lineItemId: string;
    orderName: string; customerName: string; customerEmail: string | null; customerPhone: string | null;
    address: string; distanceKm: number | null; productTitle: string;
}): Promise<ConfirmResult> {
    const { shop, date, slot, orderId } = args;
    const confirmedToken = "order-" + orderId + "-" + args.lineItemId;

    const already = await db.installationBooking.findUnique({ where: { holdToken: confirmedToken } });
    if (already) return { status: "already", bookingId: already.id, notifiedAt: already.notifiedAt };

    const data = {
        status: "CONFIRMED",
        holdToken: confirmedToken,
        holdExpiresAt: null,
        shopifyOrderId: orderId,
        orderName: args.orderName,
        customerName: args.customerName,
        customerEmail: args.customerEmail,
        customerPhone: args.customerPhone,
        address: args.address,
        distanceKm: args.distanceKm,
        productTitle: args.productTitle,
    };

    try {
        return await db.$transaction(async (tx) => {
            const existing = await tx.installationBooking.findUnique({
                where: { shop_date_timeSlot: { shop, date, timeSlot: slot } },
            });
            if (existing && existing.status === "CONFIRMED") {
                return { status: "conflict", conflictOrderName: existing.orderName } as ConfirmResult;
            }
            if (existing) {
                const updated = await tx.installationBooking.update({ where: { id: existing.id }, data });
                return { status: "confirmed", bookingId: updated.id, notifiedAt: null } as ConfirmResult;
            }
            const created = await tx.installationBooking.create({ data: { shop, date, timeSlot: slot, ...data } });
            return { status: "confirmed", bookingId: created.id, notifiedAt: null } as ConfirmResult;
        });
    } catch (err: any) {
        if (err?.code === "P2002") {
            const winner = await db.installationBooking.findUnique({
                where: { shop_date_timeSlot: { shop, date, timeSlot: slot } },
            });
            return { status: "conflict", conflictOrderName: winner?.orderName || null };
        }
        throw err;
    }
}

// ---------------- Notifications (email via Resend, SMS via ClickSend) ----------------

export type InstallationNotice = {
    orderName: string;
    customerName: string;
    customerEmail: string | null;
    customerPhone: string | null;
    date: string;
    slot: string;
    address: string;
    distanceKm: number | null;
    productTitle: string;
    conflictWith?: string | null;
    shippingWarning?: string | null;
    adminOrderUrl?: string;
};

function splitList(value: string): string[] {
    return value.split(/[,;\s]+/).map((v) => v.trim()).filter(Boolean);
}

function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

export async function sendInstallationEmail(to: string, n: InstallationNotice): Promise<boolean> {
    const recipients = splitList(to).filter((e) => e.includes("@"));
    if (!recipients.length || !process.env.RESEND_API_KEY) return false;
    const when = formatBookingDate(n.date) + ", " + n.slot;
    const subject = (n.conflictWith ? "⚠️ SLOT CONFLICT — " : "") +
        "Installation Booked — Order " + n.orderName + " — " + when;
    const rows: [string, string][] = [
        ["Order", n.orderName],
        ["Customer", n.customerName],
        ["Installation date", formatBookingDate(n.date)],
        ["Installation time", n.slot],
        ["Installation address", n.address],
        ["Distance from base", n.distanceKm !== null ? n.distanceKm.toFixed(1) + " km" : "—"],
        ["Product", n.productTitle],
        ["Customer phone", n.customerPhone || "—"],
        ["Customer email", n.customerEmail || "—"],
    ];
    const warnings = [
        n.conflictWith ? "This time slot was already booked by order " + n.conflictWith + ". Please contact the customer to arrange a new time." : "",
        n.shippingWarning || "",
    ].filter(Boolean);
    const html =
        "<div style=\"font-family:Arial,sans-serif;font-size:14px;color:#111\">" +
        "<h2 style=\"margin:0 0 12px\">New installation booking</h2>" +
        warnings.map((w) => "<p style=\"background:#fff3cd;border:1px solid #f0c36d;padding:10px;border-radius:6px\"><strong>⚠️ " + escapeHtml(w) + "</strong></p>").join("") +
        "<table cellpadding=\"6\" style=\"border-collapse:collapse\">" +
        rows.map(([k, v]) => "<tr><td style=\"color:#666;border-bottom:1px solid #eee\">" + escapeHtml(k) + "</td><td style=\"border-bottom:1px solid #eee\"><strong>" + escapeHtml(v) + "</strong></td></tr>").join("") +
        "</table>" +
        (n.adminOrderUrl ? "<p><a href=\"" + escapeHtml(n.adminOrderUrl) + "\">Open order in Shopify Admin</a></p>" : "") +
        "<p style=\"color:#888\">— Mozemo Signage Configurator</p></div>";
    try {
        const resend = new Resend(process.env.RESEND_API_KEY);
        const result = await resend.emails.send({
            from: process.env.RESEND_FROM_EMAIL || "Mozemo Signage <onboarding@resend.dev>",
            to: recipients,
            subject,
            html,
        });
        if (result.error) {
            console.error("Installation: Resend rejected email", result.error);
            return false;
        }
        return true;
    } catch (err) {
        console.error("Installation: email failed", err);
        return false;
    }
}

export async function sendInstallationSms(to: string, n: InstallationNotice): Promise<boolean> {
    const username = process.env.CLICKSEND_USERNAME;
    const apiKey = process.env.CLICKSEND_API_KEY;
    const numbers = splitList(to.replace(/(\d)\s+(?=\d)/g, "$1")).filter((p) => /^\+?\d{8,15}$/.test(p));
    if (!username || !apiKey || !numbers.length) return false;
    const body =
        (n.conflictWith ? "SLOT CONFLICT (also booked by " + n.conflictWith + ")! " : "") +
        "Mozemo installation booked: Order " + n.orderName + ", " + n.customerName + ", " +
        formatBookingDate(n.date) + " " + n.slot + ". " + n.address +
        (n.customerPhone ? ". Ph " + n.customerPhone : "");
    try {
        const res = await fetch("https://rest.clicksend.com/v3/sms/send", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: "Basic " + Buffer.from(username + ":" + apiKey).toString("base64"),
            },
            body: JSON.stringify({
                messages: numbers.map((num) => ({
                    source: "mozemo-app",
                    body: body.slice(0, 600),
                    to: num,
                    ...(process.env.CLICKSEND_FROM ? { from: process.env.CLICKSEND_FROM } : {}),
                })),
            }),
        });
        const data: any = await res.json().catch(() => ({}));
        if (!res.ok || data?.response_code !== "SUCCESS") {
            console.error("Installation: ClickSend error", res.status, data?.response_msg || data);
            return false;
        }
        return true;
    } catch (err) {
        console.error("Installation: SMS failed", err);
        return false;
    }
}
