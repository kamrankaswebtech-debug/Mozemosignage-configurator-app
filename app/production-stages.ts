// Production pipeline stages for configurator orders (stored on ProductionBlueprint.productionStatus).
// Shared by the Dashboard and the Production Orders page.
export const PRODUCTION_STAGES = [
    { key: "NEW", label: "New Order", color: "#4dd4ff" },
    { key: "ARTWORK", label: "Artwork / Design", color: "#b06bff" },
    { key: "APPROVED", label: "Artwork Approved", color: "#ff8a3d" },
    { key: "PRODUCTION", label: "In Production", color: "#ff2ec4" },
    { key: "READY", label: "Ready to Ship", color: "#ffd23d" },
    { key: "SHIPPED", label: "Shipped / Installed", color: "#00e0a4" },
] as const;

export type StageKey = (typeof PRODUCTION_STAGES)[number]["key"];

export function normalizeStage(value: string | null | undefined): StageKey {
    const v = String(value || "").toUpperCase();
    return (PRODUCTION_STAGES.find((s) => s.key === v)?.key || "NEW") as StageKey;
}

export function stageInfo(value: string | null | undefined) {
    const key = normalizeStage(value);
    return PRODUCTION_STAGES.find((s) => s.key === key)!;
}

// ---- Popular choices from the line-item properties saved with every configurator order ----
// Property names differ per configurator, so each group lists every name that means the same thing.
const CHOICE_GROUPS = [
    { key: "colour", title: "Colours", names: ["Neon Colour", "Front Colour", "Lighting Colour", "Face Colour", "LED Lighting", "Bulb Colour", "Side Colour", "Side & Back Colour"] },
    { key: "font", title: "Fonts", names: ["Font"] },
    { key: "size", title: "Sizes", names: ["Size", "Height", "Overall Width", "Overall Width / Diameter"] },
] as const;

// "Red (Standard)" -> "Red", "Ice Blue (single colour)" -> "Ice Blue", "60 cm" stays as is.
function cleanValue(value: string) {
    return String(value || "")
        .replace(/\s*\((standard|gloss|metallic|brushed metal|custom|single colour)\)\s*$/i, "")
        .replace(/\s+/g, " ")
        .trim();
}

export type ChoiceRow = { label: string; count: number; percent: number };
export type ChoiceGroup = { key: string; title: string; total: number; rows: ChoiceRow[] };

export function popularChoices(records: { propertiesJson: string; quantity?: number | null }[], top = 5): ChoiceGroup[] {
    const counts: Record<string, Record<string, number>> = {};
    CHOICE_GROUPS.forEach((g) => { counts[g.key] = {}; });
    records.forEach((r) => {
        let props: { name: string; value: string }[] = [];
        try { props = JSON.parse(r.propertiesJson || "[]"); } catch { props = []; }
        if (!Array.isArray(props)) return;
        const qty = Math.max(1, Number(r.quantity) || 1);
        CHOICE_GROUPS.forEach((g) => {
            // one value per group per line item (the first matching property)
            const hit = props.find((p) => p && (g.names as readonly string[]).includes(p.name) && String(p.value || "").trim());
            if (!hit) return;
            const label = cleanValue(hit.value);
            if (!label || /^(n\/a|none|default)$/i.test(label)) return;
            counts[g.key][label] = (counts[g.key][label] || 0) + qty;
        });
    });
    return CHOICE_GROUPS.map((g) => {
        const entries = Object.entries(counts[g.key]).sort((a, b) => b[1] - a[1]);
        const total = entries.reduce((s, e) => s + e[1], 0);
        return {
            key: g.key,
            title: g.title,
            total,
            rows: entries.slice(0, top).map(([label, count]) => ({ label, count, percent: total ? Math.round((count / total) * 100) : 0 })),
        };
    });
}
