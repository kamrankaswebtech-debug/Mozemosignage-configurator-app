import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { HubCardGrid } from "../components/admin-ui";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    await authenticate.admin(request);
    return null;
};

const SECTIONS = [
    { title: "Sizes", path: "/app/uv-graphic-led/sizes", description: "Shared with UV Graphic LED — size options and pricing." },
    { title: "Materials", path: "/app/uv-graphic-led/materials", description: "Shared with UV Graphic LED — Acrylic, Aluminium, etc." },
    { title: "Finish", path: "/app/uv-graphic-led/finishes", description: "Shared with UV Graphic LED — Gloss, Matte finish options." },
    { title: "Add-ons", path: "/app/uv-graphic-led/addons", description: "Shared with UV Graphic LED — optional add-ons." },
];

export default function UvGraphicNoLedHub() {
    return (
        <s-page heading="UV Graphic Signs (Without Neon Lighting)">
            <s-section heading="Configurator Options">
                <s-paragraph>
                    UV Graphic Signs With and Without Neon Lighting now use one combined configurator. Manage all options under
                    UV Graphic Signs; the Without Neon Lighting price is set per size there.
                </s-paragraph>
                <s-link href="/app/uv-graphic-led">Open UV Graphic Signs</s-link>
                <HubCardGrid items={SECTIONS.map((section) => ({ title: section.title, description: section.description, path: section.path }))} />
            </s-section>
        </s-page>
    );
}