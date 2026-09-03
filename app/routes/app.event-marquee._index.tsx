import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    await authenticate.admin(request);
    return null;
};

export default function EventMarqueeHub() {
    const cards = [
        { title: "Letter Styles", desc: "Manage letter style options and their extra pricing.", href: "/app/event-marquee/styles" },
        { title: "Sizes", desc: "Manage letter height options and their pricing.", href: "/app/event-marquee/sizes" },
        { title: "Bulb Colours", desc: "Manage bulb colour options and their extra pricing.", href: "/app/event-marquee/colours" },
        { title: "Mounting", desc: "Manage mounting options (Freestanding Stand, Wall Mount, Hanging, etc.).", href: "/app/event-marquee/mounting" },
        { title: "Add-ons", desc: "Manage optional add-ons.", href: "/app/event-marquee/addons" },
    ];

    return (
        <s-page heading="Event Marquee Letter Signs Configurator">
            <s-section heading="Configurator Options">
                <p style={{ marginBottom: "16px" }}>
                    Manage all the dynamic options shown in the Event Marquee Letter Signs live configurator on your storefront. Changes here appear immediately on your store — no code changes needed.
                </p>
                {cards.map((card) => (
                    <div key={card.href} style={{ border: "1px solid #e1e1e1", borderRadius: "8px", padding: "16px", marginBottom: "12px" }}>
                        <strong>{card.title}</strong>
                        <p style={{ margin: "4px 0" }}>{card.desc}</p>
                        <s-link href={card.href}>Manage {card.title} →</s-link>
                    </div>
                ))}
            </s-section>
        </s-page>
    );
}