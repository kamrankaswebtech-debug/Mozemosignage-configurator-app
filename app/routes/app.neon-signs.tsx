import type { LoaderFunctionArgs } from "react-router";
import { Outlet, useLocation } from "react-router";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    await authenticate.admin(request);
    return null;
};

const SECTIONS = [
    { title: "Fonts", path: "/app/neon-signs/fonts", description: "Manage available font styles shown in the configurator." },
    { title: "Colours", path: "/app/neon-signs/colours", description: "Manage LED colour options and their extra pricing." },
    { title: "Sizes", path: "/app/neon-signs/sizes", description: "Manage sign size options and their pricing." },
    { title: "Backboard Styles", path: "/app/neon-signs/backboard-styles", description: "Manage backboard style options." },
    { title: "Backboard Colours", path: "/app/neon-signs/backboard-colours", description: "Manage backboard colour options." },
    { title: "Add-ons", path: "/app/neon-signs/addons", description: "Manage optional add-ons like mounting kits and remotes." },
    { title: "Power Adapters", path: "/app/neon-signs/power-adapters", description: "Manage region-specific power adapter options." },
    { title: "Quick Symbols", path: "/app/neon-signs/quick-symbols", description: "Upload SVG icons (heart, star, moon, etc.) customers can click to add to their design." },
    { title: "Background Images", path: "/app/neon-signs/background-images", description: "Upload room/wall mockup photos shown behind the live preview." },
    { title: "Custom Size Slider", path: "/app/neon-signs/size-slider", description: "Configure the unit, min/max range, and price-per-unit for the optional custom-size slider." },
    { title: "Colour Effect Modes", path: "/app/neon-signs/effect-modes", description: "Manage Single Colour, RGB Colour Changing, and Multicoloured Text options." },
];

export default function NeonSignsHub() {
    const location = useLocation();
    const isHubRoot = location.pathname === "/app/neon-signs" || location.pathname === "/app/neon-signs/";

    if (!isHubRoot) {
        return <Outlet />;
    }

    return (
        <s-page heading="Neon Signs Configurator">
            <s-section heading="Configurator Options">
                <s-paragraph>
                    Manage all the dynamic options shown in the Neon Sign live configurator on your storefront.
                    Changes here appear immediately on your store — no code changes needed.
                </s-paragraph>
                <s-stack direction="block" gap="base">
                    {SECTIONS.map((section) => (
                        <s-box key={section.path} padding="base" borderWidth="base" borderRadius="base" background="subdued">
                            <s-heading>{section.title}</s-heading>
                            <s-paragraph>{section.description}</s-paragraph>
                            <s-link href={section.path}>Manage {section.title} →</s-link>
                        </s-box>
                    ))}
                </s-stack>
            </s-section>
        </s-page>
    );
}