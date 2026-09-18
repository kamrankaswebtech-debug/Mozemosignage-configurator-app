import type { LoaderFunctionArgs } from "react-router";
import { Outlet, useLocation } from "react-router";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    await authenticate.admin(request);
    return null;
};

const SECTIONS = [
    { title: "Sizes", path: "/app/acrylic-bonnet/sizes", description: "Manage available heights (30cm–150cm) and their selling prices." },
    { title: "Face Colours", path: "/app/acrylic-bonnet/colours", description: "Manage front acrylic face colour options and their extra pricing." },
    { title: "Lighting Modes", path: "/app/acrylic-bonnet/lighting-modes", description: "Manage Single Colour, Multiple Colours, and RGB lighting options." },
    { title: "Add-ons", path: "/app/acrylic-bonnet/addons", description: "Manage optional add-ons for this product." },
];

export default function AcrylicBonnetHub() {
    const location = useLocation();
    const isHubRoot = location.pathname === "/app/acrylic-bonnet" || location.pathname === "/app/acrylic-bonnet/";

    if (!isHubRoot) {
        return <Outlet />;
    }

    return (
        <s-page heading="Acrylic Neon Bonnet Stand / Wall Sign Combo">
            <s-section heading="Configurator Options">
                <s-paragraph>
                    Manage all the dynamic options shown in the Acrylic Neon Bonnet live configurator on your
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