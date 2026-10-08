import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { HubCardGrid } from "../components/admin-ui";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    await authenticate.admin(request);
    return null;
};

export default function SettingsHub() {
    const cards = [
        {
            title: "Select Products",
            description: "Mark each product as \"Configurator\" (uses a custom app block) or \"Preorder\" (plain, no customization).",
            path: "/app/settings/products",
            icon: "box",
        },
        {
            title: "Manage Demo Videos",
            description: "Add or update the walkthrough videos shown from the \"Demo\" button on your dashboard (YouTube, Vimeo, or an uploaded file). You can add more than one.",
            path: "/app/settings/demo-videos",
            icon: "play",
        },
    ];

    return (
        <s-page heading="Settings">
            <s-section heading="Product Management">
                <p className="moz-hub-intro">
                    Manage which products use the custom app configurators, and which are plain ready-to-order products managed entirely from Shopify Admin.
                </p>
                <HubCardGrid items={cards} />
            </s-section>
        </s-page>
    );
}
