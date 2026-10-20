import type { LoaderFunctionArgs } from "react-router";
import { Outlet, useLocation } from "react-router";
import { authenticate } from "../shopify.server";
import { HubCardGrid } from "../components/admin-ui";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    await authenticate.admin(request);
    return null;
};

const SECTIONS = [
    { title: "Shapes", path: "/app/lightbox/shapes", description: "Circle/Round, Square, Rectangle, Star, Oval, Hexagon, Octagon and Other — with optional extra price." },
    { title: "Double-Sided Price", path: "/app/lightbox/types", description: "Add a type with Type \"Double-Sided surcharge\" to change the +$49.99 (Wall Hanging only)." },
    { title: "Sizing & Pricing", path: "/app/3d-signs/pricing-settings", description: "Shared with 3D Illuminated Signs — width / height tiers. Wall Mount 40–500 cm, Wall Hanging 40–100 cm." },
    { title: "Side & Pole / Bracket Colours", path: "/app/3d-signs/front-colours", description: "Shared with 3D Signs colours; finishes Glossy, Shiny (Chrome) and Matte from Material / Finish." },
    { title: "Wallpaper", path: "/app/settings/wallpapers", description: "One consistent background — upload it and tick Lightbox." },
];

export default function LightboxHub() {
    const location = useLocation();
    const isHubRoot = location.pathname === "/app/lightbox" || location.pathname === "/app/lightbox/";

    if (!isHubRoot) {
        return <Outlet />;
    }

    return (
        <s-page heading="3D LED Lightbox">
            <s-section heading="Configurator Options">
                <s-paragraph>
                    Manage all the dynamic options shown in the Lightbox Range live configurator on your
                    storefront. Changes here appear immediately on your store — no code changes needed.
                </s-paragraph>
                <HubCardGrid items={SECTIONS.map((section) => ({ title: section.title, description: section.description, path: section.path }))} />
            </s-section>
        </s-page>
    );
}