import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

// A cancelled order frees its installation time slot so another customer can book it.
export const action = async ({ request }: ActionFunctionArgs) => {
    const { shop, topic, payload } = await authenticate.webhook(request);
    console.log(`Received ${topic} webhook for ${shop}`);

    try {
        const order: any = payload;
        const result = await db.installationBooking.deleteMany({
            where: { shop, shopifyOrderId: String(order.id) },
        });
        if (result.count > 0) {
            console.log(`Released ${result.count} installation slot(s) for cancelled order ${order.name || order.id}`);
        }
    } catch (err) {
        console.error("Failed to release installation booking for cancelled order:", err);
    }

    return new Response();
};
