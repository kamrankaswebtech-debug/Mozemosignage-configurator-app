import type { LoaderFunctionArgs } from "react-router";
import { Outlet, useLocation } from "react-router";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    await authenticate.admin(request);
    return null;
};

const SECTIONS = [
    { title: "Illumination Type", path: "/app/3d-signs/illumination-type", description: "Backlit, Frontlit, Front & Backlit, Fully Illuminated 3D Acrylic." },
    { title: "Wallpapers", path: "/app/3d-signs/wallpapers", description: "Store-front/desk-front background images shown behind the live preview." },
    { title: "Sizes", path: "/app/3d-signs/sizes", description: "Manage 3D sign size options and their pricing." },
    { title: "Materials", path: "/app/3d-signs/materials", description: "Acrylic, Metal Backing, Wood Backing, etc." },
    { title: "Acrylic Thickness", path: "/app/3d-signs/acrylic-thickness", description: "3mm, 5mm, 10mm, etc." },
    { title: "Width / Length Pricing Tiers", path: "/app/3d-signs/width-tiers", description: "Starting price breakpoints by overall width/length (NEW live-measurement pricing)." },
    { title: "Letter Height Pricing Tiers", path: "/app/3d-signs/letter-height-tiers", description: "Price adjustment by letter height, e.g. 30cm +$100 (NEW live-measurement pricing)." },
    { title: "Letter Count Pricing Tiers", path: "/app/3d-signs/letter-count-tiers", description: "Surcharge by number of letters/characters typed (NEW live-measurement pricing)." },
    { title: "Depth / Thickness Pricing Tiers", path: "/app/3d-signs/depth-tiers", description: "Surcharge by sign depth/thickness (NEW live-measurement pricing)." },
    { title: "Pricing Settings", path: "/app/3d-signs/pricing-settings", description: "Outdoor surcharge %, backing panel rate, included letters, base letter height (NEW live-measurement pricing)." },
    { title: "Front Colours", path: "/app/3d-signs/front-colours", description: "Front acrylic colour options." },
    { title: "Finish", path: "/app/3d-signs/finishes", description: "Matte, Glossy, Brushed Metal, etc." },
    { title: "Mounting", path: "/app/3d-signs/mounting", description: "Wall Mount, Standoff Mount, Freestanding, etc." },
    { title: "Add-ons", path: "/app/3d-signs/addons", description: "Optional add-ons for 3D illuminated signs." },
];

export default function ThreeDSignsHub() {
    const location = useLocation();
    const isHubRoot = location.pathname === "/app/3d-signs" || location.pathname === "/app/3d-signs/";

    if (!isHubRoot) {
        return <Outlet />;
    }

    return (
        <s-page heading="3D Illuminated Signs Configurator">
            <s-section heading="Configurator Options">
                <s-paragraph>
                    Manage all the dynamic options shown in the 3D Illuminated Sign live configurator on your storefront.
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