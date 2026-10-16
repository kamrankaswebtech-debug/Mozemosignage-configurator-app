import type { LoaderFunctionArgs } from "react-router";
import { Outlet, useLocation } from "react-router";
import { authenticate } from "../shopify.server";
import { HubCardGrid } from "../components/admin-ui";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    await authenticate.admin(request);
    return null;
};

const SECTIONS = [
    { title: "Lightbox Types", path: "/app/lightbox/types", description: "Slim, Fully Illuminated and Metal-Sided lightboxes and which lighting (single / double / all-around) each offers." },
    { title: "Sizes", path: "/app/lightbox/sizes", description: "Sizes and prices per Lightbox Type and lighting (single-sided, double-sided, all-around)." },
    { title: "Frame Colours", path: "/app/lightbox/frame-colours", description: "Manage outdoor aluminium frame colour options." },
];

export default function LightboxHub() {
    const location = useLocation();
    const isHubRoot = location.pathname === "/app/lightbox" || location.pathname === "/app/lightbox/";

    if (!isHubRoot) {
        return <Outlet />;
    }

    return (
        <s-page heading="Lightbox Range">
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