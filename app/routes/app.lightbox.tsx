import type { LoaderFunctionArgs } from "react-router";
import { Outlet, useLocation } from "react-router";
import { authenticate } from "../shopify.server";
import { HubCardGrid } from "../components/admin-ui";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    await authenticate.admin(request);
    return null;
};

const SECTIONS = [
    { title: "Illumination (image & price)", path: "/app/3d-signs/illumination-type", description: "Add ONE illumination type with Effect \"Lightbox\" — upload its example image and set its price." },
    { title: "Material / Finish", path: "/app/3d-signs/finishes", description: "Shared with 3D Signs — Glossy, Matte and Chrome Shine side finishes (with example images)." },
    { title: "Mounting & Sides Images", path: "/app/lightbox/mounting", description: "Example image + short text for the Wall Mount, Wall Hanging, Front-Facing and Double-Sided cards." },
    { title: "Shapes", path: "/app/lightbox/shapes", description: "Circle/Round, Square, Rectangle, Star, Oval, Hexagon, Octagon and Other — with optional extra price." },
    { title: "Sizes & Prices", path: "/app/lightbox/sizes", description: "The size boxes on the storefront — single-sided and double-sided price for each size." },
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