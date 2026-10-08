import type { CSSProperties, ReactNode } from "react";
import { Link } from "react-router";

// Shared visual building blocks for the embedded Admin app (styles live in app/styles/admin.css).
// Purely presentational — no data loading or form logic in here.

const ICON_PATHS: Record<string, string> = {
    text: '<path d="M4 6V4h16v2"/><path d="M12 4v16"/><path d="M8 20h8"/>',
    palette: '<path d="M12 3a9 9 0 0 0 0 18c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1.1.9-2 2-2h2.4A4.6 4.6 0 0 0 22 9.8C22 6 17.5 3 12 3z"/><circle cx="7.5" cy="11" r="1.2"/><circle cx="10.5" cy="7" r="1.2"/><circle cx="15.5" cy="7.5" r="1.2"/>',
    ruler: '<path d="M3 17 17 3l4 4L7 21z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5L5 20"/>',
    plus: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 8v8M8 12h8"/>',
    plug: '<path d="M9 2v5M15 2v5"/><path d="M6 7h12v3a6 6 0 0 1-12 0z"/><path d="M12 16v6"/>',
    tools: '<path d="M14.5 6.5a4 4 0 0 0 5 5L21 13l-8 8-2-2 8-8"/><path d="M14.5 6.5 9 1 7 3l5.5 5.5"/><path d="M3 21l6-6"/>',
    star: '<path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z"/>',
    frame: '<rect x="3" y="3" width="18" height="18" rx="2"/><rect x="7" y="7" width="10" height="10" rx="1"/>',
    tag: '<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
    bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V17h5v-1.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"/>',
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
    box: '<path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"/><path d="M3 7.5 12 12l9-4.5M12 12v9"/>',
    play: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="m10 9 5 3-5 3z"/>',
    gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v9h14v-9M12 8v13"/><path d="M12 8S10.5 3 8 3.5 7.5 8 12 8zM12 8s1.5-5 4-4.5S16.5 8 12 8z"/>',
    shapes: '<circle cx="7" cy="7" r="4"/><rect x="13" y="13" width="8" height="8" rx="1"/><path d="M17 3l4 7h-8z"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    neon: '<path d="M5 19V5l7 9 7-9v14"/>',
    cube: '<path d="M12 2 3 7v10l9 5 9-5V7z"/><path d="M3 7l9 5 9-5M12 12v10"/>',
    mirror: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5.5"/><circle cx="12" cy="12" r="2"/>',
    orders: '<path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6M9 13h7M9 17h5"/>',
    check: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.8 2.8L16.5 9.5"/>',
    circle: '<circle cx="12" cy="12" r="9"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    dollar: '<path d="M12 2v20"/><path d="M17 6.5c0-1.9-2.2-3-5-3s-5 1.2-5 3.2c0 4.8 10 2.6 10 7.6 0 2-2.2 3.2-5 3.2s-5-1.1-5-3"/>',
};

// Picks an icon from a card title when none is given (e.g. "Background Images" -> image).
export function iconForTitle(title: string): string {
    const t = title.toLowerCase();
    const rules: [string, RegExp][] = [
        ["play", /video|demo/], ["box", /product/], ["gift", /bundle|package|deal/],
        ["dollar", /pric|tier|cost/], ["calendar", /install|booking/], ["image", /image|wallpaper|background|photo/],
        ["text", /font|letter|text/], ["palette", /colou?r/], ["plug", /power|adapter/],
        ["star", /symbol|icon/], ["frame", /backboard|backing|mount|frame|stand/], ["layers", /material|finish|thick|depth/],
        ["bulb", /illumin|led|light|effect|lighting/], ["eye", /visib|indoor|outdoor|neon type/], ["ruler", /size|unit|slider|width|height/],
        ["shapes", /shape|style/], ["plus", /add-?on|extra|option/], ["tag", /type|mode/],
    ];
    const hit = rules.find(([, re]) => re.test(t));
    return hit ? hit[0] : "settings";
}

export function AdminIcon({ name, size = 20 }: { name: string; size?: number }) {
    const paths = ICON_PATHS[name] || ICON_PATHS.settings;
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: paths }}
        />
    );
}

export type HubCardItem = { title: string; description: string; path: string; icon?: string };

// Responsive grid of "manage this option" cards used on every configurator hub page.
export function HubCardGrid({ items, accent }: { items: HubCardItem[]; accent?: string }) {
    return (
        <div className="moz-hub-grid" style={accent ? ({ "--moz-accent": accent } as CSSProperties) : undefined}>
            {items.map((item) => (
                <Link key={item.path} to={item.path} className="moz-hub-card">
                    <span className="moz-hub-card__icon">
                        <AdminIcon name={item.icon || iconForTitle(item.title)} />
                    </span>
                    <span className="moz-hub-card__body">
                        <span className="moz-hub-card__title">{item.title}</span>
                        <span className="moz-hub-card__desc">{item.description}</span>
                        <span className="moz-hub-card__cta">Manage →</span>
                    </span>
                </Link>
            ))}
        </div>
    );
}

// Short intro line shown above a hub grid.
export function HubIntro({ children }: { children: ReactNode }) {
    return <p className="moz-hub-intro">{children}</p>;
}
