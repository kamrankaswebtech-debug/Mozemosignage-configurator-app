import { useEffect, useMemo, useRef, useState } from "react";
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
    // Fonts only: Event Marquee fonts are opt-in (manufacturer-approved marquee fonts), so this key
    // is never implied by "shown everywhere" (empty show_on).
    marquee_font: "Event Marquee",
    lightbox: "3D LED Lightbox",
};
const FAMILY_3D = ["3d", "infinity", "marquee", "lightbox"];

// metaType: the metaobject type when the list key is only a filtered view of another type.
type TypeDef = { title: string; keys: string[]; labelKey: string; categories?: string[]; optIn?: string[]; metaType?: string };
const TYPES: Record<string, TypeDef> = {
    sign3d_front_colour: { title: "3D Colours (front, side, backing, bulb, lighting)", keys: FAMILY_3D, labelKey: "name" },
    sign3d_addon: { title: "3D Add-ons (Included With Your Order & optional)", keys: FAMILY_3D, labelKey: "label", categories: ["addon"], metaType: "sign3d_option" },
    sign3d_option: { title: "3D Material / Finish & Mounting", keys: FAMILY_3D, labelKey: "label", categories: ["finish", "mounting"] },
    neon_font: { title: "Fonts", keys: ["neon", "graphic", "3d", "infinity", "marquee_font"], labelKey: "name", optIn: ["marquee_font"] },
    neon_quick_symbol: { title: "Quick Symbols", keys: ["neon", "graphic", "3d"], labelKey: "label" },
    power_adapter: { title: "Power Adapters", keys: ["neon", "graphic", "bonnet", "3d", "infinity", "marquee", "lightbox"], labelKey: "label" },
    neon_colour: { title: "Neon Colours", keys: ["neon", "graphic", "bonnet"], labelKey: "name" },
    sign_size: { title: "Neon Sizes", keys: ["neon", "graphic"], labelKey: "label" },
    backboard_style: { title: "Backboard Styles", keys: ["neon", "graphic"], labelKey: "label" },
    backboard_colour: { title: "Backboard Colours", keys: ["neon", "graphic"], labelKey: "label" },
    neon_effect_mode: { title: "Colour / Effect Modes", keys: ["neon", "graphic"], labelKey: "label" },
    signage_addon: { title: "Neon Add-ons & Indoor / Outdoor", keys: ["neon", "graphic"], labelKey: "label", categories: ["", "addon", "neon_type"] },
};

type Entry = { id: string; label: string; category: string; showOn: string[]; isFree?: boolean };

// Keys implied by an empty show_on ("shown everywhere"): every key except the opt-in ones.
const defaultKeys = (def: TypeDef) => def.keys.filter((k) => !(def.optIn || []).includes(k));

const parseShowOn = (value: string, def: TypeDef) => {
    const list = String(value || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    return list.length ? def.keys.filter((k) => list.includes(k)) : defaultKeys(def);
};

// Everything shown (and no opt-in key) = "" (every configurator, also ones added later); none = "none".
const toValue = (picked: string[], def: TypeDef) => {
    const keys = def.keys.filter((k) => picked.includes(k));
    const base = defaultKeys(def);
    const isDefault = keys.length === base.length && base.every((k) => keys.includes(k));
    return isDefault ? "" : (keys.length ? keys.join(",") : "none");
};

const sameKeys = (a: string[], b: string[]) => a.length === b.length && a.every((k) => b.includes(k));

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { admin } = await authenticate.admin(request);
    const url = new URL(request.url);
    const type = TYPES[url.searchParams.get("type") || ""] ? String(url.searchParams.get("type")) : "sign3d_front_colour";
    const def = TYPES[type];
    const response = await admin.graphql(
        `#graphql
    query VisibilityList($type: String!) { metaobjects(type: $type, first: 250) { edges { node { id fields { key value } } } } }`,
        { variables: { type: "$app:" + (def.metaType || type) } }
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
                showOn: parseShowOn(f.show_on, def),
                isFree: f.is_free === "true",
                sort: Number(f.sort_order || 0),
            };
        })
        .filter((e: any) => !def.categories || def.categories.includes(e.category))
        .sort((a: any, b: any) => (a.category || "").localeCompare(b.category || "") || a.sort - b.sort);
    return { type, entries };
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const { admin } = await authenticate.admin(request);
    const formData = await request.formData();
    const type = String(formData.get("type") || "");
    const def = TYPES[type];
    if (!def) return { error: "Unknown type" };

    // Either per-entry values ("updates" = [{ id, keys }]) or one value for every id ("keys" + "ids").
    let updates: { id: string; value: string }[] = [];
    const rawUpdates = formData.get("updates");
    if (rawUpdates) {
        try {
            updates = (JSON.parse(String(rawUpdates)) || [])
                .filter((u: any) => u && typeof u.id === "string" && Array.isArray(u.keys))
                .map((u: any) => ({ id: u.id, value: toValue(u.keys.map(String), def) }));
        } catch {
            return { error: "Invalid data" };
        }
    } else {
        const picked = formData.getAll("keys").map(String);
        const value = toValue(picked, def);
        updates = String(formData.get("ids") || "").split(",").filter(Boolean).map((id) => ({ id, value }));
    }
    if (!updates.length) return { error: "Nothing to update" };

    // Batched aliases (25 per request) — same approach as the Quick Symbols bulk visibility.
    for (let i = 0; i < updates.length; i += 25) {
        const chunk = updates.slice(i, i + 25);
        const body = chunk
            .map((u, idx) => `u${idx}: metaobjectUpdate(id: ${JSON.stringify(u.id)}, metaobject: { fields: [{ key: "show_on", value: ${JSON.stringify(u.value)} }] }) { userErrors { message } }`)
            .join("\n");
        const response = await admin.graphql(`#graphql
      mutation SetShowOn { ${body} }`);
        const data = await response.json();
        const errs = Object.values(data.data || {}).flatMap((r: any) => r?.userErrors || []);
        if (errs.length) return { error: (errs[0] as any).message };
    }
    // The saved keys of every entry, so the page shows exactly what was stored.
    return { success: true, count: updates.length, saved: updates.map((u) => ({ id: u.id, keys: u.value === "none" ? [] : parseShowOn(u.value, def) })) };
};

function KeyChecks({ keys, picked, onToggle, disabled }: { keys: string[]; picked: string[]; onToggle: (k: string, on: boolean) => void; disabled?: boolean }) {
    return (
        <>
            {keys.map((k) => (
                <label key={k} style={{ display: "inline-flex", alignItems: "center", gap: 4, marginRight: 14 }}>
                    <input type="checkbox" checked={picked.includes(k)} disabled={disabled} onChange={(e) => onToggle(k, e.currentTarget.checked)} /> {CONFIGURATORS[k]}
                </label>
            ))}
        </>
    );
}

// One entry row with its own request, so saving one row never cancels or resets another.
function EntryRow({ type, def, entry, picked, dirty, onToggle, onSaved }: {
    type: string; def: TypeDef; entry: Entry; picked: string[]; dirty: boolean;
    onToggle: (k: string, on: boolean) => void; onSaved: (saved: { id: string; keys: string[] }[]) => void;
}) {
    const fetcher = useFetcher<typeof action>();
    const shopify = useAppBridge();
    const busy = fetcher.state !== "idle";
    const handled = useRef<unknown>(null);
    useEffect(() => {
        if (!fetcher.data || handled.current === fetcher.data) return;
        handled.current = fetcher.data;
        if ("success" in fetcher.data && fetcher.data.success) {
            onSaved(fetcher.data.saved || []);
            shopify.toast.show("Visibility saved — " + entry.label);
        } else if ("error" in fetcher.data && fetcher.data.error) {
            shopify.toast.show(fetcher.data.error, { isError: true });
        }
    }, [fetcher.data, shopify, onSaved, entry.label]);
    const save = () => {
        const fd = new FormData();
        fd.set("type", type);
        fd.set("updates", JSON.stringify([{ id: entry.id, keys: picked }]));
        fetcher.submit(fd, { method: "post" });
    };
    return (
        <tr style={{ borderBottom: "1px solid #eee", background: dirty ? "#fff8e1" : undefined }}>
            <td style={{ padding: "8px", whiteSpace: "nowrap" }}>
                {entry.label}
                {entry.category ? <><br /><small style={{ color: "#888" }}>{entry.category === "neon_type" ? "Indoor / Outdoor" : entry.category === "addon" && def.metaType === "sign3d_option" ? (entry.isFree ? "Included With Your Order" : "Optional add-on") : entry.category}</small></> : null}
                {dirty ? <><br /><small style={{ color: "#b26a00" }}>Not saved yet</small></> : null}
            </td>
            <td style={{ padding: "8px" }}>
                <KeyChecks keys={def.keys} picked={picked} onToggle={onToggle} disabled={busy} />
                <s-button variant="tertiary" onClick={save} {...(busy ? { loading: true } : {})}>Save</s-button>
            </td>
        </tr>
    );
}

export default function ConfiguratorVisibilityPage() {
    const { type, entries } = useLoaderData<typeof loader>();
    const def = TYPES[type];
    const shopify = useAppBridge();
    const navigate = useNavigate();
    const bulkFetcher = useFetcher<typeof action>();
    const bulkBusy = bulkFetcher.state !== "idle";

    // saved: what is stored in Shopify (loader data, overridden by the result of our own saves, so a
    // reload that is still in flight can never flip a row back). picks: what is ticked on screen.
    const loaderMap = useMemo(() => {
        const m: Record<string, string[]> = {};
        entries.forEach((e) => { m[e.id] = e.showOn; });
        return m;
    }, [entries]);
    const [overrides, setOverrides] = useState<Record<string, string[]>>({});
    const [picks, setPicks] = useState<Record<string, string[]>>({});
    const [bulkPicked, setBulkPicked] = useState<string[]>(defaultKeys(def));

    // New type selected: start clean.
    useEffect(() => {
        setOverrides({});
        setPicks({});
        setBulkPicked(defaultKeys(TYPES[type]));
    }, [type]);

    // Drop overrides the loader has caught up with.
    useEffect(() => {
        setOverrides((prev) => {
            let changed = false;
            const next = { ...prev };
            Object.keys(next).forEach((id) => {
                if (!loaderMap[id] || sameKeys(loaderMap[id], next[id])) { delete next[id]; changed = true; }
            });
            return changed ? next : prev;
        });
    }, [loaderMap]);

    const savedOf = (id: string) => overrides[id] || loaderMap[id] || [];
    const pickedOf = (id: string) => picks[id] || savedOf(id);
    const isDirty = (id: string) => !!picks[id] && !sameKeys(picks[id], savedOf(id));
    const dirtyIds = entries.map((e) => e.id).filter(isDirty);

    const onSaved = useMemo(() => (saved: { id: string; keys: string[] }[]) => {
        setOverrides((prev) => {
            const next = { ...prev };
            saved.forEach((s) => { next[s.id] = s.keys; });
            return next;
        });
        setPicks((prev) => {
            const next = { ...prev };
            saved.forEach((s) => { if (next[s.id] && sameKeys(next[s.id], s.keys)) delete next[s.id]; });
            return next;
        });
    }, []);

    const toggle = (id: string) => (k: string, on: boolean) => {
        setPicks((prev) => {
            const cur = prev[id] || savedOf(id);
            const nextKeys = on ? def.keys.filter((x) => x === k || cur.includes(x)) : cur.filter((x) => x !== k);
            return { ...prev, [id]: nextKeys };
        });
    };

    // Column helper: tick / untick one configurator on every entry (on screen only, then "Save all changes").
    const setColumn = (k: string, on: boolean) => {
        setPicks((prev) => {
            const next = { ...prev };
            entries.forEach((e) => {
                const cur = prev[e.id] || savedOf(e.id);
                next[e.id] = on ? def.keys.filter((x) => x === k || cur.includes(x)) : cur.filter((x) => x !== k);
            });
            return next;
        });
    };

    const handledBulk = useRef<unknown>(null);
    useEffect(() => {
        if (!bulkFetcher.data || handledBulk.current === bulkFetcher.data) return;
        handledBulk.current = bulkFetcher.data;
        if ("success" in bulkFetcher.data && bulkFetcher.data.success) {
            onSaved(bulkFetcher.data.saved || []);
            shopify.toast.show("Visibility saved (" + bulkFetcher.data.count + ")");
        } else if ("error" in bulkFetcher.data && bulkFetcher.data.error) {
            shopify.toast.show(bulkFetcher.data.error, { isError: true });
        }
    }, [bulkFetcher.data, shopify, onSaved]);

    const saveAllChanges = () => {
        if (!dirtyIds.length) return;
        const fd = new FormData();
        fd.set("type", type);
        fd.set("updates", JSON.stringify(dirtyIds.map((id) => ({ id, keys: pickedOf(id) }))));
        bulkFetcher.submit(fd, { method: "post" });
    };
    const applyToAll = () => {
        if (!entries.length) return;
        if (!confirm("Set the same visibility on all " + entries.length + " entries?")) return;
        const fd = new FormData();
        fd.set("type", type);
        fd.set("updates", JSON.stringify(entries.map((e) => ({ id: e.id, keys: bulkPicked }))));
        bulkFetcher.submit(fd, { method: "post" });
        setPicks({});
    };

    return (
        <s-page heading="Configurator Visibility">
            <s-section heading="Choose what to manage">
                <s-link href="/app/settings">← Back to Settings</s-link>
                <s-paragraph>
                    Tick the configurators each entry should appear on. All ticked = shown everywhere (default for every existing entry).
                    Changes appear on the storefront straight away — no code needed. Fonts and Quick Symbols also keep their own
                    "Neon Only / 3D Only" setting on their pages; both rules apply.
                </s-paragraph>
                {def.optIn?.includes("marquee_font") ? (
                    <s-paragraph>
                        Fonts — Event Marquee: only fonts ticked here appear on the Event Marquee (manufacturer-approved marquee fonts);
                        the built-in marquee font is always offered first. A font ticked ONLY for Event Marquee (e.g. a licensed marquee
                        font) replaces the built-in font as the default.
                    </s-paragraph>
                ) : null}
                <select value={type} onChange={(e) => navigate("/app/settings/visibility?type=" + e.target.value)}>
                    {Object.entries(TYPES).map(([k, d]) => <option key={k} value={k}>{d.title}</option>)}
                </select>
            </s-section>

            <s-section heading={"Bulk Visibility — all " + def.title + " (" + entries.length + ")"}>
                <s-stack direction="block" gap="base">
                    <div>
                        <strong>Tick / untick one configurator on every entry</strong> (only on this screen — then press "Save all changes"):
                        <div style={{ marginTop: 8 }}>
                            {def.keys.map((k) => (
                                <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 6, marginRight: 18, marginBottom: 6 }}>
                                    {CONFIGURATORS[k]}:
                                    <s-button variant="tertiary" onClick={() => setColumn(k, true)}>Tick all</s-button>
                                    <s-button variant="tertiary" onClick={() => setColumn(k, false)}>Untick all</s-button>
                                </span>
                            ))}
                        </div>
                    </div>
                    <div>
                        <strong>Same visibility on every entry</strong> (saves straight away):
                        <div style={{ marginTop: 8 }}>
                            <KeyChecks keys={def.keys} picked={bulkPicked} disabled={bulkBusy}
                                onToggle={(k, on) => setBulkPicked((p) => (on ? def.keys.filter((x) => x === k || p.includes(x)) : p.filter((x) => x !== k)))} />
                            <s-button onClick={applyToAll} {...(bulkBusy ? { loading: true } : {})}>Apply to all</s-button>
                        </div>
                    </div>
                </s-stack>
            </s-section>

            <s-section heading="Per entry">
                <div style={{ position: "sticky", top: 0, zIndex: 2, background: "#fff", padding: "8px 0", display: "flex", gap: 12, alignItems: "center" }}>
                    <s-button variant="primary" onClick={saveAllChanges} {...(bulkBusy ? { loading: true } : {})} {...(!dirtyIds.length ? { disabled: true } : {})}>
                        {"Save all changes (" + dirtyIds.length + ")"}
                    </s-button>
                    {dirtyIds.length ? <s-button variant="tertiary" onClick={() => setPicks({})}>Discard changes</s-button> : null}
                    <small style={{ color: "#666" }}>Each row also has its own Save button.</small>
                </div>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                        <tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
                            <th style={{ padding: "8px" }}>Entry</th>
                            <th style={{ padding: "8px" }}>Show on</th>
                        </tr>
                    </thead>
                    <tbody>
                        {entries.map((e) => (
                            <EntryRow key={e.id} type={type} def={def} entry={e} picked={pickedOf(e.id)} dirty={isDirty(e.id)}
                                onToggle={toggle(e.id)} onSaved={onSaved} />
                        ))}
                    </tbody>
                </table>
            </s-section>
        </s-page>
    );
}
