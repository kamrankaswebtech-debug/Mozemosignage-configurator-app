import type { LoaderFunctionArgs } from "react-router";
import { Outlet, useLocation } from "react-router";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    await authenticate.admin(request);
    return null;
};

const SECTIONS = [
    { title: "Shapes", path: "/app/lightbox/shapes", description: "Manage Circle/Round, Square, and Rectangle shape options." },
    { title: "Sizes", path: "/app/lightbox/sizes", description: "Manage available sizes and pricing for single-sided and double-sided lightboxes." },
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