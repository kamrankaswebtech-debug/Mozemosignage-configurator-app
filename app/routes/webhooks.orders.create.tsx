import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { generateBlueprintPdfBuffer } from "../utils/blueprint-pdf.server";
import {
    confirmBooking,
    formatBookingDate,
    getInstallationSettings,
    haversineKm,
    sendInstallationEmail,
    sendInstallationSms,
} from "../utils/installation.server";

function slugify(input: string) {
    return (input || "customer")
        .trim()
        .replace(/[^a-zA-Z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .toUpperCase();
}

function propValue(properties: any[], name: string): string {
    const found = (properties || []).find((p: any) => p && p.name === name);
    return found ? String(found.value ?? "").trim() : "";
}

// Installation booking: confirm the held slot, make the booking clearly visible on the
// Shopify order (tag + note + Additional details) and instantly notify the client by email
// and SMS. Runs in its own try/catch so it can never affect the blueprint logic below.
async function handleInstallationBookings(shop: string, order: any, admin: any) {
    const lineItems: any[] = Array.isArray(order.line_items) ? order.line_items : [];
    const installItems = lineItems.filter((item) => {
        const props = Array.isArray(item.properties) ? item.properties : [];
        return /^yes/i.test(propValue(props, "Installation")) &&
            (propValue(props, "_install_date") || propValue(props, "Installation Date")) &&
            propValue(props, "Installation Time");
    });
    if (installItems.length === 0) return;

    const settings = admin ? await getInstallationSettings(admin, shop, true) : null;
    const orderId = String(order.id);
    const orderName = order.name || `#${order.order_number || order.id}`;
    const customerName = order.customer
        ? `${order.customer.first_name || ""} ${order.customer.last_name || ""}`.trim() || order.shipping_address?.name || "Customer"
        : order.shipping_address?.name || order.billing_address?.name || "Customer";
    const customerEmail = order.customer?.email || order.email || null;
    const customerPhone = order.shipping_address?.phone || order.customer?.phone || order.phone || order.billing_address?.phone || null;
    const adminOrderUrl = `https://admin.shopify.com/store/${shop.replace(/\.myshopify\.com$/, "")}/orders/${order.id}`;

    // Informational only: flag when the checkout shipping address is outside the radius too.
    let shippingWarning: string | null = null;
    const ship = order.shipping_address;
    if (settings && settings.baseLat !== null && settings.baseLng !== null && ship && ship.latitude != null && ship.longitude != null) {
        const shipKm = haversineKm(settings.baseLat, settings.baseLng, Number(ship.latitude), Number(ship.longitude));
        if (shipKm > settings.radiusKm) {
            shippingWarning = `Shipping address is ${shipKm.toFixed(1)} km from base (outside the ${settings.radiusKm} km area). Please check the installation address with the customer.`;
        }
    }

    const noteLines: string[] = [];
    const attributes: { key: string; value: string }[] = [];
    let hasConflict = false;

    for (let i = 0; i < installItems.length; i++) {
        const item = installItems[i];
        const props = item.properties;
        // "_install_date" is the machine-readable YYYY-MM-DD; "Installation Date" is the
        // customer-friendly label (older carts stored YYYY-MM-DD there directly).
        const date = propValue(props, "_install_date") || propValue(props, "Installation Date");
        const slot = propValue(props, "Installation Time");
        const address = propValue(props, "Installation Address") || "Same as shipping address";
        const distanceRaw = parseFloat(propValue(props, "_install_distance_km"));
        const distanceKm = Number.isFinite(distanceRaw) ? distanceRaw : null;
        const productTitle = item.title || item.name || "Custom Sign";

        const result = await confirmBooking({
            shop,
            token: propValue(props, "_install_hold"),
            date,
            slot,
            orderId,
            lineItemId: String(item.id),
            orderName,
            customerName,
            customerEmail,
            customerPhone,
            address,
            distanceKm,
            productTitle,
        });

        const conflictWith = result.status === "conflict" ? result.conflictOrderName || "another order" : null;
        if (conflictWith) hasConflict = true;

        const suffix = installItems.length > 1 ? ` (${i + 1})` : "";
        const when = `${formatBookingDate(date)}, ${slot}`;
        noteLines.push(
            `🛠 INSTALLATION BOOKED${suffix}: ${when} — ${address}` +
            (distanceKm !== null ? ` (${distanceKm.toFixed(1)} km)` : "") +
            (conflictWith ? ` ⚠️ SLOT CONFLICT with ${conflictWith} — contact customer to reschedule` : ""),
        );
        attributes.push(
            { key: `Installation Date${suffix}`, value: formatBookingDate(date) },
            { key: `Installation Time${suffix}`, value: slot },
            { key: `Installation Address${suffix}`, value: address },
        );

        // Shopify can retry a webhook — only notify once per booking.
        const alreadyNotified = result.status !== "conflict" && result.notifiedAt;
        if (!alreadyNotified && settings) {
            const notice = {
                orderName, customerName, customerEmail, customerPhone, date, slot, address,
                distanceKm, productTitle, conflictWith, shippingWarning, adminOrderUrl,
            };
            const [emailOk, smsOk] = await Promise.all([
                sendInstallationEmail(settings.notifyEmail, notice),
                sendInstallationSms(settings.notifyPhone, notice),
            ]);
            console.log(`Installation ${orderName}: ${result.status}, email=${emailOk}, sms=${smsOk}`);
            if (result.status !== "conflict" && (emailOk || smsOk)) {
                await db.installationBooking.update({ where: { id: result.bookingId }, data: { notifiedAt: new Date() } });
            }
        }
    }

    if (!admin) return;
    const orderGid = `gid://shopify/Order/${order.id}`;

    const tags = ["Installation Booked"];
    if (hasConflict) tags.push("Installation Conflict");
    const tagResponse = await admin.graphql(
        `#graphql
    mutation InstallationTags($id: ID!, $tags: [String!]!) {
      tagsAdd(id: $id, tags: $tags) { userErrors { field message } }
    }`,
        { variables: { id: orderGid, tags } },
    );
    const tagData: any = await tagResponse.json();
    if (tagData?.data?.tagsAdd?.userErrors?.length) {
        console.error("Installation: tagsAdd error", tagData.data.tagsAdd.userErrors);
    }

    const existingNote: string = order.note || "";
    if (existingNote.includes("INSTALLATION BOOKED")) return; // webhook retry — already written
    const existingAttributes = (Array.isArray(order.note_attributes) ? order.note_attributes : [])
        .map((a: any) => ({ key: String(a.name), value: String(a.value ?? "") }));
    const newKeys = new Set(attributes.map((a) => a.key));
    const mergedAttributes = [...existingAttributes.filter((a: any) => !newKeys.has(a.key)), ...attributes];
    const note = [noteLines.join("\n"), existingNote].filter(Boolean).join("\n\n");

    const updateResponse = await admin.graphql(
        `#graphql
    mutation InstallationOrderUpdate($input: OrderInput!) {
      orderUpdate(input: $input) { userErrors { field message } }
    }`,
        { variables: { input: { id: orderGid, note, customAttributes: mergedAttributes } } },
    );
    const updateData: any = await updateResponse.json();
    if (updateData?.data?.orderUpdate?.userErrors?.length) {
        console.error("Installation: orderUpdate error", updateData.data.orderUpdate.userErrors);
    }
}

export const action = async ({ request }: ActionFunctionArgs) => {
    const { shop, topic, payload, admin } = await authenticate.webhook(request);
    console.log(`Received ${topic} webhook for ${shop}`);

    try {
        await handleInstallationBookings(shop, payload, admin);
    } catch (err) {
        console.error("Failed to process installation booking:", err);
    }

    try {
        const order: any = payload;
        const lineItems: any[] = Array.isArray(order.line_items) ? order.line_items : [];

        // Only line items that came from a configurator (i.e. have custom properties attached)
        const configuredItems = lineItems.filter(
            (item) => Array.isArray(item.properties) && item.properties.length > 0,
        );

        if (configuredItems.length === 0) {
            return new Response();
        }

        const customerName = order.customer
            ? `${order.customer.first_name || ""} ${order.customer.last_name || ""}`.trim()
            : order.shipping_address?.name || "Customer";
        const customerEmail = order.customer?.email || order.email || null;
        const destination = order.shipping_address
            ? [order.shipping_address.city, order.shipping_address.country].filter(Boolean).join(", ")
            : "N/A";
        const orderDate = order.created_at ? new Date(order.created_at).toLocaleDateString("en-AU") : "";
        const orderNumber = order.order_number || order.id;
        const customerSlug = slugify(customerName);

        for (let i = 0; i < configuredItems.length; i++) {
            const item = configuredItems[i];
            const properties = (item.properties || []).map((p: any) => ({ name: p.name, value: String(p.value ?? "") }));

            const widthProp = properties.find((p) => p.name === "_blueprint_width_cm");
            const heightProp = properties.find((p) => p.name === "_blueprint_height_cm");
            const referenceImageProp = properties.find(
                (p) => /^https?:\/\//i.test(p.value) && /\.(png|jpe?g|webp|gif)(\?|$)/i.test(p.value),
            );

            const fileName =
                configuredItems.length > 1
                    ? `MS-${orderNumber}-${i + 1}_${customerSlug}_SIGN_BLUEPRINT.pdf`
                    : `MS-${orderNumber}_${customerSlug}_SIGN_BLUEPRINT.pdf`;

            const pdfBuffer = await generateBlueprintPdfBuffer({
                orderName: order.name || `#${orderNumber}`,
                orderNumber,
                orderDate,
                customerName,
                status: (order.financial_status || "pending").toUpperCase(),
                productTitle: item.title || item.name || "Custom Sign",
                quantity: item.quantity || 1,
                destination,
                properties,
                widthCm: widthProp ? parseFloat(widthProp.value) : undefined,
                heightCm: heightProp ? parseFloat(heightProp.value) : undefined,
                referenceImageUrl: referenceImageProp?.value,
                fileName,
            });

            await db.productionBlueprint.create({
                data: {
                    shop,
                    shopifyOrderId: String(order.id),
                    orderName: order.name || `#${orderNumber}`,
                    orderNumber: typeof orderNumber === "number" ? orderNumber : null,
                    lineItemId: String(item.id),
                    productTitle: item.title || item.name || "Custom Sign",
                    quantity: item.quantity || 1,
                    customerName,
                    customerEmail,
                    destination,
                    orderStatus: order.financial_status || "pending",
                    propertiesJson: JSON.stringify(properties),
                    fileName,
                    pdfData: pdfBuffer,
                },
            });
        }
    } catch (err) {
        console.error("Failed to generate production blueprint PDF:", err);
    }

    return new Response();
};