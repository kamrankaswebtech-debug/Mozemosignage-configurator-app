import type { LoaderFunctionArgs } from "react-router";
import { Outlet, useLocation } from "react-router";
import { authenticate } from "../shopify.server";
import { HubCardGrid } from "../components/admin-ui";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    await authenticate.admin(request);
    return null;
};

const SECTIONS = [
    { title: "Sizes", path: "/app/uv-graphic-led/sizes", description: "Size options with prices With and Without Neon Lighting." },
    { title: "Materials", path: "/app/uv-graphic-led/materials", description: "Acrylic, Aluminium, etc." },
    { title: "Finish", path: "/app/uv-graphic-led/finishes", description: "Gloss, Matte finish options." },
    { title: "LED Colours", path: "/app/uv-graphic-led/led-colours", description: "Neon / LED colour options (shown only With Neon Lighting)." },
    { title: "Add-ons", path: "/app/uv-graphic-led/addons", description: "Optional add-ons — choose if each one shows With Neon, Without Neon, or both." },
    { title: "Power Adapters", path: "/app/neon-signs/power-adapters", description: "Shared with Neon Signs — region-specific power adapters." },
];

export default function UvGraphicLedHub() {
    const location = useLocation();
    const isHubRoot = location.pathname === "/app/uv-graphic-led" || location.pathname === "/app/uv-graphic-led/";

    if (!isHubRoot) {
        return <Outlet />;
    }

    return (
        <s-page heading="UV Graphic Signs Configurator">
            <s-section heading="Configurator Options">
                <s-paragraph>
                    One configurator for UV Graphic Signs With Neon Lighting and Without Neon Lighting. The customer picks the lighting
                    option on the storefront; LED colours and power adapters only show With Neon Lighting, and each size can have its own
                    price Without Neon Lighting.
                </s-paragraph>
                <HubCardGrid items={SECTIONS.map((section) => ({ title: section.title, description: section.description, path: section.path }))} />
            </s-section>
        </s-page>
    );
}