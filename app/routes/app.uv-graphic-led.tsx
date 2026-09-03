import type { LoaderFunctionArgs } from "react-router";
import { Outlet, useLocation } from "react-router";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    await authenticate.admin(request);
    return null;
};

const SECTIONS = [
    { title: "Sizes", path: "/app/uv-graphic-led/sizes", description: "Manage UV Graphic sign size options and their pricing." },
    { title: "Materials", path: "/app/uv-graphic-led/materials", description: "Acrylic, Aluminium, etc." },
    { title: "Finish", path: "/app/uv-graphic-led/finishes", description: "Gloss, Matte finish options." },
    { title: "LED Colours", path: "/app/uv-graphic-led/led-colours", description: "LED backlighting colour options (LED variant only)." },
    { title: "Add-ons", path: "/app/uv-graphic-led/addons", description: "Optional add-ons for UV Graphic signs." },
    { title: "Power Adapters", path: "/app/neon-signs/power-adapters", description: "Shared with Neon Signs — region-specific power adapters." },
];

export default function UvGraphicLedHub() {
    const location = useLocation();
    const isHubRoot = location.pathname === "/app/uv-graphic-led" || location.pathname === "/app/uv-graphic-led/";

    if (!isHubRoot) {
        return <Outlet />;
    }

    return (
        <s-page heading="UV Graphic LED Signs Configurator">
            <s-section heading="Configurator Options">
                <s-paragraph>
                    Manage all the dynamic options shown in the UV Graphic LED Sign live configurator on your storefront.
                    Sizes, Materials, Finish, and Add-ons here are shared with the UV Graphic (No LED) configurator.
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