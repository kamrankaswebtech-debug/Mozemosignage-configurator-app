import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { HubCardGrid } from "../components/admin-ui";

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
                <p className="moz-hub-intro">
                    Manage the base packages and add-ons shown on the Bulk & Bundle Deals / Business Fit-Outs page. Changes here appear immediately on your store — no code changes needed.
                </p>
                <HubCardGrid items={cards.map((card) => ({ title: card.title, description: card.desc, path: card.href }))} />
            </s-section>
        </s-page>
    );
}