import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { generateBlueprintPdfBuffer } from "../utils/blueprint-pdf.server";

function slugify(input: string) {
    return (input || "customer")
        .trim()
        .replace(/[^a-zA-Z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .toUpperCase();
}

export const action = async ({ request }: ActionFunctionArgs) => {
    const { shop, topic, payload } = await authenticate.webhook(request);
    console.log(`Received ${topic} webhook for ${shop}`);

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