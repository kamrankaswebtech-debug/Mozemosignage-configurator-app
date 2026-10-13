import { useState } from "react";

// "Content Background Colour" for storefront wallpapers (Neon + 3D): the colour behind the
// options panel. "" = auto (picked from the wallpaper's colours on the storefront),
// otherwise a #rrggbb the merchant chose. Anything else is treated as auto.
export function readContentBgColor(formData: FormData): string {
    if (formData.get("contentBgMode") !== "custom") return "";
    const value = String(formData.get("contentBgColor") || "").trim().toLowerCase();
    return /^#[0-9a-f]{6}$/.test(value) ? value : "";
}

export function ContentBgField({ initial }: { initial: string }) {
    const [mode, setMode] = useState(initial ? "custom" : "auto");
    return (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 12 }}>Content background:</span>
            <select name="contentBgMode" value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="auto">Auto (from image)</option>
                <option value="custom">Custom colour</option>
            </select>
            {mode === "custom" && <input type="color" name="contentBgColor" defaultValue={initial || "#c0b8b4"} />}
        </span>
    );
}

export function ContentBgCell({ color }: { color: string }) {
    if (!color) return <>Auto</>;
    return (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 18, height: 18, borderRadius: 4, border: "1px solid #ccc", background: color }}></span>
            {color}
        </span>
    );
}
