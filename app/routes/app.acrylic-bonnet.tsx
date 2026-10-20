import type { LoaderFunctionArgs } from "react-router";
import { Outlet, useLocation } from "react-router";
import { authenticate } from "../shopify.server";
import { HubCardGrid } from "../components/admin-ui";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    await authenticate.admin(request);
    return null;
};

const SECTIONS = [
    { title: "Heights", path: "/app/acrylic-bonnet/sizes", description: "Heights 40, 50, 60, 70, 80, 90 and 100 cm with their prices." },
    { title: "Front Face & LED Colours", path: "/app/neon-signs/colours", description: "Shared with Neon Signs — Front Face uses all neon colours (incl. black), LED Colour the same list without black." },
    { title: "Wallpapers (Engine Bay / Garage Wall)", path: "/app/settings/wallpapers", description: "Upload both photos and tick Acrylic Bonnet — name them Engine Bay and Garage Wall." },
    { title: "Lighting Modes", path: "/app/acrylic-bonnet/lighting-modes", description: "Manage Single Colour, Multiple Colours, and RGB lighting options." },
    { title: "Add-ons", path: "/app/acrylic-bonnet/addons", description: "Power & controls: Remote Control, Dimmer and Power Cable only." },
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
                <HubCardGrid items={SECTIONS.map((section) => ({ title: section.title, description: section.description, path: section.path }))} />
            </s-section>
        </s-page>
    );
}