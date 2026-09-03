import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    await authenticate.admin(request);
    return null;
};

export default function BundleDealsHub() {
    const cards = [
        { title: "Packages", desc: "Manage base package options and their pricing.", href: "/app/bundle-deals/packages" },
        { title: "Add-ons", desc: "Manage optional add-ons and their extra pricing.", href: "/app/bundle-deals/addons" },
    ];

    return (
        <s-page heading="Bulk & Bundle Deals Configurator">
            <s-section heading="Configurator Options">
                <p style={{ marginBottom: "16px" }}>
                    Manage the base packages and add-ons shown on the Bulk & Bundle Deals / Business Fit-Outs page. Changes here appear immediately on your store — no code changes needed.
                </p>
                {cards.map((card) => (
                    <div key={card.href} style={{ border: "1px solid #e1e1e1", borderRadius: "8px", padding: "16px", marginBottom: "12px" }}>
                        <strong>{card.title}</strong>
                        <p style={{ margin: "4px 0" }}>{card.desc}</p>
                        <s-link href={card.href}>Manage {card.title} →</s-link>
                    </div>
                ))}
            </s-section>
        </s-page>
    );
}