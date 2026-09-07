import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    await authenticate.admin(request);
    return null;
};

export default function SettingsHub() {
    return (
        <s-page heading="Settings">
            <s-section heading="Product Management">
                <p style={{ marginBottom: "16px" }}>
                    Manage which products use the custom app configurators, and which are plain ready-to-order products managed entirely from Shopify Admin.
                </p>
                <div style={{ border: "1px solid #e1e1e1", borderRadius: "8px", padding: "16px" }}>
                    <strong>Select Products</strong>
                    <p style={{ margin: "4px 0" }}>Mark each product as "Configurator" (uses a custom app block) or "Preorder" (plain, no customization).</p>
                    <s-link href="/app/settings/products">Manage Products →</s-link>
                </div>
            </s-section>
        </s-page>
    );
}