import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

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
        <s-page heading="UV Graphic Signs (No LED) Configurator">
            <s-section heading="Configurator Options">
                <s-paragraph>
                    This configurator shares its Size, Material, Finish, and Add-on options with UV Graphic LED Signs
                    (since both product types use the same base options). No LED Colour selection applies here.
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