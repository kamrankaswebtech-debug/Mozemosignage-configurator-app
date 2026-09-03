import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    await authenticate.admin(request);
    return null;
};

export default function InfinityMirrorHub() {
    const cards = [
        { title: "Fonts", desc: "Manage available font styles shown in the configurator.", href: "/app/infinity-mirror/fonts" },
        { title: "Sizes", desc: "Manage sign size options and their pricing.", href: "/app/infinity-mirror/sizes" },
        { title: "LED Colours", desc: "Manage LED colour options and their extra pricing.", href: "/app/infinity-mirror/colours" },
        { title: "Frame Finishes", desc: "Manage mirror frame finish options (Black, Gold, Silver, etc.).", href: "/app/infinity-mirror/frame-finishes" },
        { title: "Mounting", desc: "Manage mounting options (Wall Mount, Freestanding Base, etc.).", href: "/app/infinity-mirror/mounting" },
        { title: "Add-ons", desc: "Manage optional add-ons.", href: "/app/infinity-mirror/addons" },
    ];

    return (
        <s-page heading="Infinity Mirror Letter Signs Configurator">
            <s-section heading="Configurator Options">
                <p style={{ marginBottom: "16px" }}>
                    Manage all the dynamic options shown in the Infinity Mirror Letter Signs live configurator on your storefront. Changes here appear immediately on your store — no code changes needed.
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