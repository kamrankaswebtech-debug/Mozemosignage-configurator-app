import type { LoaderFunctionArgs } from "react-router";
import { Outlet, useLocation } from "react-router";
import { authenticate } from "../shopify.server";
import { HubCardGrid } from "../components/admin-ui";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    await authenticate.admin(request);
    return null;
};

const SECTIONS = [
    { title: "Design Type Images", path: "/app/uv-graphic-led/design-type", description: "Images on the Graphic Only and Text + Graphic cards. Without an image a simple icon is shown." },
    { title: "Size Prices (UV)", path: "/app/uv-graphic-led/sizes", description: "Optional UV prices per Neon size width — With and Without Neon Lighting. Sizes not listed use the Neon price." },
    { title: "UV Add-ons", path: "/app/uv-graphic-led/addons", description: "Extra UV-only add-ons, shown With Neon, Without Neon, or both (Neon add-ons are included automatically)." },
    { title: "Neon Colours", path: "/app/neon-signs/colours", description: "Shared with Neon Signs — neon colours (With Neon Lighting)." },
    { title: "Sizes", path: "/app/neon-signs/sizes", description: "Shared with Neon Signs — the size list shown on UV Graphic." },
    { title: "Backboard Styles", path: "/app/neon-signs/backboard-styles", description: "Shared with Neon Signs — UV shows only Cut Around, Rectangle, Open Box and Acrylic Stand." },
    { title: "Backboard Colours", path: "/app/neon-signs/backboard-colours", description: "Shared with Neon Signs — backboard colour options." },
    { title: "Colour / Effect Modes", path: "/app/neon-signs/effect-modes", description: "Shared with Neon Signs — single colour, RGB etc. (Multicoloured Text is letter-based, so not offered on UV)." },
    { title: "Indoor / Outdoor", path: "/app/neon-signs/neon-types", description: "Shared with Neon Signs — outdoor is only offered from 60 cm wide (With Neon Lighting)." },
    { title: "Neon Add-ons", path: "/app/neon-signs/addons", description: "Shared with Neon Signs — paid add-ons and items included with the order (With Neon Lighting)." },
    { title: "Power Adapters", path: "/app/neon-signs/power-adapters", description: "Shared with Neon Signs — shown With Neon Lighting." },
];

export default function UvGraphicLedHub() {
    const location = useLocation();
    const isHubRoot = location.pathname === "/app/uv-graphic-led" || location.pathname === "/app/uv-graphic-led/";

    if (!isHubRoot) {
        return <Outlet />;
    }

    return (
        <s-page heading="Graphic LED & Non-LED Neon Signs Configurator">
            <s-section heading="Configurator Options">
                <s-paragraph>
                    One configurator with both options: With Neon Lighting and Without Neon Lighting. It uses the same options and rules as the
                    Neon Sign configurator (colours, sizes, backboards, effects, Indoor/Outdoor, add-ons, installation) — minus fonts and
                    quick symbols — plus the printed graphic upload. Most options are edited under Neon Signs; the two UV pages below
                    only set UV-specific prices and extras.
                </s-paragraph>
                <HubCardGrid items={SECTIONS.map((section) => ({ title: section.title, description: section.description, path: section.path }))} />
            </s-section>
        </s-page>
    );
}