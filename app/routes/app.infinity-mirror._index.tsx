import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { HubCardGrid } from "../components/admin-ui";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    await authenticate.admin(request);
    return null;
};

// This configurator is the 3D Sign configurator in its own mode, so its options are managed on the
// 3D Illuminated Signs pages (shared) — plus the items below that belong to this product only.
export default function InfinityMirrorHub() {
    const cards = [
        { title: "Illumination (price)", desc: "Add ONE illumination type with Effect \"Infinity Mirror\" — upload its example image and set its price.", href: "/app/3d-signs/illumination-type" },
        { title: "Fonts", desc: "Shared with 3D Signs — the same font list.", href: "/app/neon-signs/fonts" },
        { title: "Sizes & Pricing Settings", desc: "Shared with 3D Signs — overall width, letter height, tiers and outdoor surcharge.", href: "/app/3d-signs/pricing-settings" },
        { title: "Colours", desc: "Shared with 3D Signs — the same colour range (black is left out where this product can't use it).", href: "/app/3d-signs/front-colours" },
        { title: "Material / Finish", desc: "Shared with 3D Signs — only Glossy, Matte and Chrome Shine finishes are shown here.", href: "/app/3d-signs/finishes" },
        { title: "Mounting", desc: "Shared with 3D Signs — the same mounting options and conditions.", href: "/app/3d-signs/mounting" },
        { title: "Add-ons", desc: "Shared with 3D Signs — the same add-ons.", href: "/app/3d-signs/addons" },
        { title: "Wallpapers", desc: "Settings → Configurator Wallpapers — tick this product on the photos to show.", href: "/app/settings/wallpapers" },
    ];

    return (
        <s-page heading="Infinity Mirror Signs Configurator">
            <s-section heading="Configurator Options">
                <p className="moz-hub-intro">Infinity Mirror Signs use the 3D Sign configurator (same menus, layout and functions) with only the options this sign needs: two design types — Text Only (overall width + letter height, priced per letters) and Logo Only (one round infinity mirror sized and priced by the overall width only, as one element) — fonts, one illumination type, Indoor/Outdoor, lighting and side colours (no black), side finish, colour intensity, mounting and add-ons.</p>
                <HubCardGrid items={cards.map((card) => ({ title: card.title, description: card.desc, path: card.href }))} />
            </s-section>
        </s-page>
    );
}