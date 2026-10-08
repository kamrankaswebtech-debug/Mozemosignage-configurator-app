import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { HubCardGrid } from "../components/admin-ui";

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
                <p className="moz-hub-intro">
                    Manage all the dynamic options shown in the Infinity Mirror Letter Signs live configurator on your storefront. Changes here appear immediately on your store — no code changes needed.
                </p>
                <HubCardGrid items={cards.map((card) => ({ title: card.title, description: card.desc, path: card.href }))} />
            </s-section>
        </s-page>
    );
}