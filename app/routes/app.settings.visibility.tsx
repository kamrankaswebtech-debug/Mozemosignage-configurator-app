import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useNavigate } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

// Configurator Visibility: choose, per entry, which configurators show it. Stored in the entry's
// "show_on" field as a comma list of configurator keys; empty = every configurator (default).
const CONFIGURATORS: Record<string, string> = {
    neon: "Neon Signs",
    graphic: "Graphic LED & Non-LED Neon",
    bonnet: "Acrylic Bonnet",
    "3d": "3D Illuminated Signs",
    infinity: "Infinity Mirror",
    marquee: "Event Marquee",
    lightbox: "3D LED Lightbox",
};
const FAMILY_3D = ["3d", "infinity", "marquee", "lightbox"];

type TypeDef = { title: string; keys: string[]; labelKey: string; categories?: string[] };
const TYPES: Record<string, TypeDef> = {
    sign3d_front_colour: { title: "3D Colours (front, side, backing, bulb, lighting)", keys: FAMILY_3D, labelKey: "name" },
    sign3d_option: { title: "3D Material / Finish, Mounting & Add-ons", keys: FAMILY_3D, labelKey: "label", categories: ["finish", "mounting", "addon"] },
    neon_font: { title: "Fonts", keys: ["neon", "graphic", "3d", "infinity", "marquee"], labelKey: "name" },
    neon_quick_symbol: { title: "Quick Symbols", keys: ["neon", "graphic", "3d"], labelKey: "label" },
    power_adapter: { title: "Power Adapters", keys: ["neon", "graphic", "bonnet", "3d", "infinity", "marquee", "lightbox"], labelKey: "label" },
    neon_colour: { title: "Neon Colours", keys: ["neon", "graphic", "bonnet"], labelKey: "name" },
    sign_size: { title: "Neon Sizes", keys: ["neon", "graphic"], labelKey: "label" },
    backboard_style: { title: "Backboard Styles", keys: ["neon", "graphic"], labelKey: "label" },
    backboard_colour: { title: "Backboard Colours", keys: ["neon", "graphic"], labelKey: "label" },
    neon_effect_mode: { title: "Colour / Effect Modes", keys: ["neon", "graphic"], labelKey: "label" },
    signage_addon: { title: "Neon Add-ons & Indoor / Outdoor", keys: ["neon", "graphic"], labelKey: "label", categories: ["", "addon", "neon_type"] },
};

type Entry = { id: string; label: string; category: string; showOn: string[] };

const parseShowOn = (value: string, keys: string[]) => {
    const list = String(value || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    return list.length ? keys.filter((k) => list.includes(k)) : keys.slice();
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { admin } = await authenticate.admin(request);
    const url = new URL(request.url);
    const type = TYPES[url.searchParams.get("type") || ""] ? String(url.searchParams.get("type")) : "sign3d_front_colour";
    const def = TYPES[type];
    const response = await admin.graphql(
        `#graphql
    query VisibilityList($type: String!) { metaobjects(type: $type, first: 250) { edges { node { id fields { key value } } } } }`,
        { variables: { type: "$app:" + type } }
    );
    const data = await response.json();
    const entries: Entry[] = (data.data?.metaobjects?.edges || [])
        .map((edge: any) => {
            const f: Record<string, string> = {};
            edge.node.fields.forEach((x: any) => { f[x.key] = x.value || ""; });
            return {
                id: edge.node.id,
                label: f[def.labelKey] || f.label || f.name || "(no name)",
                category: String(f.category || "").trim().toLowerCase(),
                showOn: parseShowOn(f.show_on, def.keys),
                sort: Number(f.sort_order || 0),
            };
        })
        .filter((e: any) => !def.categories || def.categories.includes(e.category))
        .sort((a: any, b: any) => (a.category || "").localeCompare(b.category || "") || a.sort - b.sort);
    return { type, entries };
};

// All configurators ticked = "" (every configurator, also ones added later); none = "none".
const toValue = (picked: string[], keys: string[]) =>
    picked.length === keys.length ? "" : (picked.length ? picked.join(",") : "none");

export const action = async ({ request }: ActionFunctionArgs) => {
    const { admin } = await authenticate.admin(request);
    const formData = await request.formData();
    const type = String(formData.get("type") || "");
    const def = TYPES[type];
    if (!def) return { error: "Unknown type" };
    const picked = formData.getAll("keys").map(String).filter((k) => def.keys.includes(k));
    const value = toValue(picked, def.keys);
    const ids = String(formData.get("ids") || "").split(",").filter(Boolean);
    if (!ids.length) return { error: "Nothing to update" };

    // Batched aliases (25 per request) — same approach as the Quick Symbols bulk visibility.
    for (let i = 0; i < ids.length; i += 25) {
        const chunk = ids.slice(i, i + 25);
        const body = chunk
            .map((id, idx) => `u${idx}: metaobjectUpdate(id: ${JSON.stringify(id)}, metaobject: { fields: [{ key: "show_on", value: ${JSON.stringify(value)} }] }) { userErrors { message } }`)
            .join("\n");
        const response = await admin.graphql(`#graphql
      mutation SetShowOn { ${body} }`);
        const data = await response.json();
        const errs = Object.values(data.data || {}).flatMap((r: any) => r?.userErrors || []);
        if (errs.length) return { error: (errs[0] as any).message };
    }
    return { success: true, count: ids.length };
};

function KeyChecks({ keys, picked }: { keys: string[]; picked: string[] }) {
    return (
        <>
            {keys.map((k) => (
                <label key={k} style={{ display: "inline-flex", alignItems: "center", gap: 4, marginRight: 14 }}>
                    <input type="checkbox" name="keys" value={k} defaultChecked={picked.includes(k)} /> {CONFIGURATORS[k]}
                </label>
            ))}
        </>
    );
}

export default function ConfiguratorVisibilityPage() {
    const { type, entries } = useLoaderData<typeof loader>();
    const def = TYPES[type];
    const fetcher = useFetcher<typeof action>();
    const shopify = useAppBridge();
    const navigate = useNavigate();
    const [formKey, setFormKey] = useState(0);
    const isSubmitting = fetcher.state !== "idle";

    useEffect(() => {
        if (fetcher.data && "success" in fetcher.data && fetcher.data.success) {
            shopify.toast.show("Visibility saved");
            setFormKey((k) => k + 1);
        }
        if (fetcher.data && "error" in fetcher.data && fetcher.data.error) shopify.toast.show(fetcher.data.error, { isError: true });
    }, [fetcher.data, shopify]);

    return (
        <s-page heading="Configurator Visibility">
            <s-section heading="Choose what to manage">
                <s-link href="/app/settings">← Back to Settings</s-link>
                <s-paragraph>
                    Tick the configurators each entry should appear on. All ticked = shown everywhere (default for every existing entry).
                    Changes appear on the storefront straight away — no code needed. Fonts and Quick Symbols also keep their own
                    "Neon Only / 3D Only" setting on their pages; both rules apply.
                </s-paragraph>
                <select value={type} onChange={(e) => navigate("/app/settings/visibility?type=" + e.target.value)}>
                    {Object.entries(TYPES).map(([k, d]) => <option key={k} value={k}>{d.title}</option>)}
                </select>
            </s-section>

            <s-section heading={"Bulk Visibility — all " + def.title + " (" + entries.length + ")"}>
                <fetcher.Form method="post" key={"bulk" + formKey}>
                    <input type="hidden" name="type" value={type} />
                    <input type="hidden" name="ids" value={entries.map((e) => e.id).join(",")} />
                    <s-stack direction="inline" gap="base">
                        <KeyChecks keys={def.keys} picked={def.keys} />
                        <s-button type="submit" {...(isSubmitting ? { loading: true } : {})}>Apply to all</s-button>
                    </s-stack>
                </fetcher.Form>
            </s-section>

            <s-section heading="Per entry">
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                        <tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
                            <th style={{ padding: "8px" }}>Entry</th>
                            <th style={{ padding: "8px" }}>Show on</th>
                        </tr>
                    </thead>
                    <tbody>
                        {entries.map((e) => (
                            <tr key={e.id + formKey} style={{ borderBottom: "1px solid #eee" }}>
                                <td style={{ padding: "8px", whiteSpace: "nowrap" }}>
                                    {e.label}
                                    {e.category ? <><br /><small style={{ color: "#888" }}>{e.category === "neon_type" ? "Indoor / Outdoor" : e.category}</small></> : null}
                                </td>
                                <td style={{ padding: "8px" }}>
                                    <fetcher.Form method="post">
                                        <input type="hidden" name="type" value={type} />
                                        <input type="hidden" name="ids" value={e.id} />
                                        <KeyChecks keys={def.keys} picked={e.showOn} />
                                        <s-button type="submit" variant="tertiary" {...(isSubmitting ? { loading: true } : {})}>Save</s-button>
                                    </fetcher.Form>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </s-section>
        </s-page>
    );
}
