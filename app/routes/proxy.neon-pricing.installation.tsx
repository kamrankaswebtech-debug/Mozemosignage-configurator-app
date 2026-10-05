// Storefront Installation booking API, served through the EXISTING app proxy
// (/apps/neon-pricing/installation) — no second [app_proxy] block.
//
// GET  ?op=config                         -> radius / base address text for the storefront
// GET  ?op=availability&date=&token=      -> slots already held/booked by OTHER customers
// GET  ?op=autocomplete&q=&session=       -> Google address suggestions (Australia only)
// POST {op:"check-address", placeId, session} -> distance + 100km eligibility (+ signed proof)
// POST {op:"hold", token, date, slot, addressProof} -> reserve the slot for this customer
// POST {op:"release", token}               -> free this customer's held slot
import crypto from "node:crypto";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
    autocompleteAddress,
    generateTimeSlots,
    getBookedSlots,
    getInstallationSettings,
    haversineKm,
    holdSlot,
    isDateBookable,
    isGoogleConfigured,
    placeDetails,
    releaseHold,
} from "../utils/installation.server";

const TOKEN_RE = /^[A-Za-z0-9_-]{8,80}$/;

// The eligibility result is signed so the browser cannot fake a distance to get around the
// 100km rule when it later asks to hold a slot.
function signProof(payload: object): string {
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const sig = crypto.createHmac("sha256", process.env.SHOPIFY_API_SECRET || "mozemo").update(body).digest("base64url");
    return body + "." + sig;
}

function readProof(proof: string): { address: string; distanceKm: number; eligible: boolean; shop: string } | null {
    if (typeof proof !== "string" || !proof.includes(".")) return null;
    const [body, sig] = proof.split(".");
    const expected = crypto.createHmac("sha256", process.env.SHOPIFY_API_SECRET || "mozemo").update(body).digest("base64url");
    if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    try {
        return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    } catch {
        return null;
    }
}

async function getContext(request: Request) {
    const { admin, session } = await authenticate.public.appProxy(request);
    if (!admin || !session) return null;
    const settings = await getInstallationSettings(admin, session.shop);
    if (!settings) return null;
    return { shop: session.shop, settings };
}

export async function loader({ request }: LoaderFunctionArgs) {
    const ctx = await getContext(request);
    if (!ctx) return Response.json({ error: "Installation is not available" }, { status: 401 });
    const { shop, settings } = ctx;
    const url = new URL(request.url);
    const op = url.searchParams.get("op");

    if (op === "config") {
        return Response.json({
            radiusKm: settings.radiusKm,
            baseAddress: settings.baseAddress,
            holdMinutes: settings.holdMinutes,
            addressLookup: isGoogleConfigured(),
        });
    }

    if (op === "availability") {
        const date = url.searchParams.get("date") || "";
        const token = url.searchParams.get("token") || "";
        if (!isDateBookable(date, settings)) {
            return Response.json({ error: "This date is not available", bookedSlots: [] }, { status: 400 });
        }
        const bookedSlots = await getBookedSlots(shop, date, TOKEN_RE.test(token) ? token : "");
        return Response.json({ date, bookedSlots }, { headers: { "Cache-Control": "no-store" } });
    }

    if (op === "autocomplete") {
        const q = (url.searchParams.get("q") || "").trim().slice(0, 200);
        const sessionToken = (url.searchParams.get("session") || "").slice(0, 80);
        if (q.length < 3) return Response.json({ suggestions: [] });
        const bias = settings.baseLat !== null && settings.baseLng !== null ? { lat: settings.baseLat, lng: settings.baseLng } : null;
        const suggestions = await autocompleteAddress(q, sessionToken, bias);
        return Response.json({ suggestions });
    }

    return Response.json({ error: "Unknown operation" }, { status: 400 });
}

export async function action({ request }: ActionFunctionArgs) {
    const ctx = await getContext(request);
    if (!ctx) return Response.json({ error: "Installation is not available" }, { status: 401 });
    const { shop, settings } = ctx;

    let body: any = {};
    try {
        body = await request.json();
    } catch {
        return Response.json({ error: "Invalid request" }, { status: 400 });
    }

    if (body.op === "check-address") {
        if (settings.baseLat === null || settings.baseLng === null) {
            return Response.json({ error: "Installation address check is not configured yet." }, { status: 503 });
        }
        const place = await placeDetails(String(body.placeId || ""), String(body.session || "").slice(0, 80));
        if (!place) {
            return Response.json({ error: "We couldn't find that address. Please select it from the suggestions." }, { status: 422 });
        }
        const distanceKm = Math.round(haversineKm(settings.baseLat, settings.baseLng, place.lat, place.lng) * 10) / 10;
        const eligible = distanceKm <= settings.radiusKm;
        const proof = eligible ? signProof({ shop, address: place.formattedAddress, distanceKm, eligible }) : "";
        return Response.json({
            eligible,
            distanceKm,
            radiusKm: settings.radiusKm,
            formattedAddress: place.formattedAddress,
            proof,
        });
    }

    if (body.op === "hold") {
        const token = String(body.token || "");
        const date = String(body.date || "");
        const slot = String(body.slot || "");
        if (!TOKEN_RE.test(token)) return Response.json({ error: "Invalid booking session" }, { status: 400 });
        if (!isDateBookable(date, settings)) return Response.json({ error: "This date is not available" }, { status: 400 });
        const validSlots = generateTimeSlots(settings.earliestTime, settings.latestTime, settings.slotInterval);
        if (!validSlots.includes(slot)) return Response.json({ error: "Invalid time slot" }, { status: 400 });

        let address = "";
        let distanceKm: number | null = null;
        if (isGoogleConfigured()) {
            const proof = readProof(String(body.addressProof || ""));
            if (!proof || !proof.eligible || proof.shop !== shop || proof.distanceKm > settings.radiusKm) {
                return Response.json({ error: "Please enter an installation address within our service area first." }, { status: 403 });
            }
            address = proof.address;
            distanceKm = proof.distanceKm;
        } else {
            // Address lookup not configured yet: still prevent double bookings, just without
            // the distance check (the storefront shows a plain address field in this mode).
            address = String(body.address || "").slice(0, 300);
        }

        const result = await holdSlot({
            shop, token, date, slot,
            address,
            distanceKm,
            holdMinutes: settings.holdMinutes,
        });
        if (!result.ok) {
            const bookedSlots = await getBookedSlots(shop, date, token);
            return Response.json({ ok: false, reason: "taken", bookedSlots }, { status: 409 });
        }
        return Response.json({ ok: true, expiresAt: result.expiresAt });
    }

    if (body.op === "release") {
        const token = String(body.token || "");
        if (TOKEN_RE.test(token)) await releaseHold(token);
        return Response.json({ ok: true });
    }

    return Response.json({ error: "Unknown operation" }, { status: 400 });
}
