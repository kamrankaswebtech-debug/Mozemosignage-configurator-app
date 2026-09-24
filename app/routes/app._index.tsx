import { useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";

// Real SVG icons (Shopify's Polaris <s-icon> set) instead of emoji — matches
// the professional look requested, no custom SVG files to host/maintain.
const CONFIGURATOR_SOURCES = [
  { title: "Neon Signs Configurator", path: "/app/neon-signs", types: ["neon_font", "neon_colour", "sign_size", "signage_addon"], icon: "lightbulb", color: "#ff2ec4" },
  { title: "3D Illuminated Signs", path: "/app/3d-signs", types: ["sign3d_size", "sign3d_front_colour", "sign3d_option"], icon: "text-font", color: "#00d4ff" },
  { title: "Acrylic Neon Bonnet", path: "/app/acrylic-bonnet", types: ["bonnet_option"], icon: "image-alt", color: "#ff8a3d" },
  { title: "Lightbox Range", path: "/app/lightbox", types: ["lightbox_option"], icon: "package", color: "#7a00ff" },
  { title: "UV Graphic LED Signs", path: "/app/uv-graphic-led", types: ["uv_size", "uv_material", "uv_finish", "uv_led_colour", "uv_addon"], icon: "paint-brush-flat", color: "#00e0a4" },
  { title: "UV Graphic Signs (No LED)", path: "/app/uv-graphic-no-led", types: ["uv_size", "uv_material", "uv_finish", "uv_addon"], icon: "image", color: "#ffd23d" },
  { title: "Infinity Mirror Signs", path: "/app/infinity-mirror", types: ["infinity_font", "infinity_size", "infinity_colour", "infinity_frame_finish", "infinity_mounting", "infinity_addon"], icon: "refresh", color: "#ff4d8d" },
  { title: "Event Marquee Signs", path: "/app/event-marquee", types: ["event_marquee_option"], icon: "star-filled", color: "#ffb03d" },
  { title: "Bulk & Bundle Deals", path: "/app/bundle-deals", types: ["bundle_option"], icon: "gift-card", color: "#4dd4ff" },
];

function toYoutubeEmbedUrl(url: string) {
  const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([a-zA-Z0-9_-]{6,})/);
  const id = match ? match[1] : "";
  return id ? `https://www.youtube.com/embed/${id}?rel=0` : url;
}

function toVimeoEmbedUrl(url: string) {
  const match = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  const id = match ? match[1] : "";
  return id ? `https://player.vimeo.com/video/${id}` : url;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  const uniqueTypes = Array.from(new Set(CONFIGURATOR_SOURCES.flatMap((c) => c.types)));
  const aliasFor = (type: string) => `t_${type}`;

  const queryParts = uniqueTypes.map((type) => {
    if (type === "sign3d_option") {
      return `${aliasFor(type)}: metaobjects(type: "$app:${type}", first: 250) { edges { node { id fields { key value } } } }`;
    }
    if (type === "signage_addon") {
      // Needs field values + video file reference (not just id) so we can also pull
      // out the demo_video entries below, without a second GraphQL round-trip.
      return `${aliasFor(type)}: metaobjects(type: "$app:${type}", first: 250) { edges { node { id fields { key value reference { ... on Video { sources { url } } } } } } }`;
    }
    return `${aliasFor(type)}: metaobjects(type: "$app:${type}", first: 250) { edges { node { id } } }`;
  });

  const combinedQuery = `#graphql
    query DashboardData {
      ${queryParts.join("\n")}
      installationSettings: metaobjects(type: "$app:installation_settings", first: 1) { edges { node { id } } }
      wallpapers: metaobjects(type: "$app:neon_background_image", first: 1) { edges { node { id } } }
      mainTheme: themes(first: 1, roles: [MAIN]) { nodes { id name } }
    }
  `;

  const [graphqlResponse, recentBlueprints, last7DaysBlueprints] = await Promise.all([
    admin.graphql(combinedQuery).then((r) => r.json()),
    db.productionBlueprint.findMany({
      where: { shop: session.shop },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: { id: true, orderName: true, productTitle: true, customerName: true, destination: true, orderStatus: true, createdAt: true },
    }),
    db.productionBlueprint.findMany({
      where: { shop: session.shop, createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
      select: { shopifyOrderId: true },
    }),
  ]);

  const gqlData = graphqlResponse.data || {};
  const countsByType: Record<string, number> = {};
  uniqueTypes.forEach((type) => {
    countsByType[type] = (gqlData[aliasFor(type)]?.edges?.length) || 0;
  });

  const configurators = CONFIGURATOR_SOURCES.map((c) => {
    const totalOptions = c.types.reduce((sum, t) => sum + (countsByType[t] || 0), 0);
    return { title: c.title, path: c.path, icon: c.icon, color: c.color, totalOptions, isConfigured: totalOptions > 0 };
  });
  const activeConfiguratorsCount = configurators.filter((c) => c.isConfigured).length;

  const hasInstallationSettings = (gqlData.installationSettings?.edges?.length || 0) > 0;
  const hasWallpapers = (gqlData.wallpapers?.edges?.length || 0) > 0;

  const mainThemeNode = gqlData.mainTheme?.nodes?.[0] || null;
  const mainThemeName = mainThemeNode?.name || null;
  const mainThemeNumericId = mainThemeNode?.id ? mainThemeNode.id.split("/").pop() : null;
  const storeHandle = session.shop.replace(".myshopify.com", "");
  const themeEditorUrl = mainThemeNumericId
    ? `https://admin.shopify.com/store/${storeHandle}/themes/${mainThemeNumericId}/editor`
    : null;
  const themeEditorProductTemplateUrl = themeEditorUrl ? `${themeEditorUrl}?template=product` : null;

  const sign3dNodes = gqlData[aliasFor("sign3d_option")]?.edges || [];
  let widthTierCount = 0;
  let hasPricingSettings = false;
  sign3dNodes.forEach((edge: any) => {
    const category = edge.node.fields.find((f: any) => f.key === "category")?.value;
    if (category === "width_tier") widthTierCount++;
    if (category === "pricing_settings") hasPricingSettings = true;
  });
  const has3dPricingConfigured = widthTierCount > 0 && hasPricingSettings;

  // ---- NEW: Demo videos, reusing signage_addon via category = "demo_video" —
  // no new metaobject definition needed (store is at the 32-definition cap). ----
  const signageAddonNodes = gqlData[aliasFor("signage_addon")]?.edges || [];
  const demoVideos = signageAddonNodes
    .map((edge: any) => {
      const f: Record<string, string> = {};
      let videoFileUrl: string | null = null;
      edge.node.fields.forEach((x: any) => {
        f[x.key] = x.value;
        if (x.key === "video_file" && x.reference?.sources?.[0]?.url) {
          videoFileUrl = x.reference.sources[0].url;
        }
      });
      return {
        id: edge.node.id,
        category: f.category || "",
        title: f.label || "Demo video",
        sourceType: f.video_source_type || "youtube",
        videoUrl: f.video_url || "",
        videoFileUrl,
        sortOrder: Number(f.sort_order) || 0,
      };
    })
    .filter((v: any) => v.category === "demo_video")
    .sort((a: any, b: any) => a.sortOrder - b.sortOrder);

  const hasCompletedOrder = recentBlueprints.length > 0;
  const newOrdersLast7Days = new Set(last7DaysBlueprints.map((b) => b.shopifyOrderId)).size;

  const setupChecklist = [
    { label: "At least one configurator has options configured", done: activeConfiguratorsCount > 0 },
    { label: "Installation booking settings created (Neon Signs)", done: hasInstallationSettings },
    { label: "At least one live-preview wallpaper uploaded", done: hasWallpapers },
    { label: "3D Sign live-measurement pricing configured", done: has3dPricingConfigured },
    { label: "At least one order has completed the full production flow", done: hasCompletedOrder },
    { label: mainThemeName ? `Connected to your live theme (${mainThemeName})` : "Live theme detected", done: !!mainThemeName },
  ];
  const setupCompletePercent = Math.round(
    (setupChecklist.filter((s) => s.done).length / setupChecklist.length) * 100
  );

  return {
    configurators,
    activeConfiguratorsCount,
    setupChecklist,
    setupCompletePercent,
    newOrdersLast7Days,
    recentBlueprints,
    mainThemeName,
    themeEditorUrl,
    themeEditorProductTemplateUrl,
    demoVideos,
  };
};

function formatStatus(rawStatus: string | null) {
  if (!rawStatus) return "Pending";
  const map: Record<string, string> = {
    paid: "Paid — In Production",
    pending: "Awaiting Payment",
    partially_paid: "Partially Paid",
    refunded: "Refunded",
    voided: "Voided",
  };
  return map[rawStatus] || rawStatus;
}

function DemoVideoPlayer({ video }: { video: any }) {
  if (video.sourceType === "youtube" && video.videoUrl) {
    return (
      <iframe
        width="100%"
        height="420"
        src={toYoutubeEmbedUrl(video.videoUrl)}
        title={video.title}
        style={{ border: "none", borderRadius: "8px" }}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
      ></iframe>
    );
  }
  if (video.sourceType === "vimeo" && video.videoUrl) {
    return (
      <iframe
        width="100%"
        height="420"
        src={toVimeoEmbedUrl(video.videoUrl)}
        title={video.title}
        style={{ border: "none", borderRadius: "8px" }}
        allow="autoplay; fullscreen; picture-in-picture"
        allowFullScreen
      ></iframe>
    );
  }
  if (video.videoFileUrl) {
    return (
      // Native <video controls> in modern Chrome/Edge/Safari already includes
      // play/pause, seek, volume, fullscreen AND a playback-speed option —
      // no extra JS player library needed for the "YouTube-like controls" ask.
      <video width="100%" height="420" controls playsInline style={{ borderRadius: "8px", background: "#000" }}>
        <source src={video.videoFileUrl} />
      </video>
    );
  }
  return <s-paragraph>This video isn't ready yet — check back in a moment, or re-upload it in Settings.</s-paragraph>;
}

export default function Dashboard() {
  const {
    configurators,
    activeConfiguratorsCount,
    setupChecklist,
    setupCompletePercent,
    newOrdersLast7Days,
    recentBlueprints,
    mainThemeName,
    themeEditorUrl,
    themeEditorProductTemplateUrl,
    demoVideos,
  } = useLoaderData<typeof loader>();

  const [activeVideoIndex, setActiveVideoIndex] = useState(0);
  const activeVideo = demoVideos[activeVideoIndex];

  return (
    <s-page heading="Mozemo Signage Configurator">
      <s-section>
        <s-box
          padding="loose"
          borderRadius="large"
          style={{ background: "linear-gradient(90deg, #ff2ec4 0%, #7a00ff 100%)" }}
        >
          <s-stack direction="inline" gap="base" alignItems="center">
            <s-box padding="base" borderRadius="base" background="base">
              <span style={{ fontSize: "28px" }}>🏷️</span>
            </s-box>
            <s-stack direction="block" gap="tight">
              <s-heading style={{ color: "#ffffff" }}>Welcome to Mozemo Signage Configurator!</s-heading>
              <s-paragraph style={{ color: "rgba(255,255,255,0.9)" }}>
                Manage all your custom neon, LED, and lightbox signage options in one place.
              </s-paragraph>
            </s-stack>
          </s-stack>
        </s-box>
      </s-section>

      <s-section heading="Overview">
        <s-stack direction="inline" gap="base" wrap>
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-paragraph>Active Configurators</s-paragraph>
            <s-heading>{activeConfiguratorsCount} / {configurators.length}</s-heading>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-paragraph>New Orders (Last 7 Days)</s-paragraph>
            <s-heading>{newOrdersLast7Days}</s-heading>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-paragraph>Average Order Value</s-paragraph>
            <s-heading>—</s-heading>
            <s-paragraph>Not tracked yet — order price isn't saved to the database.</s-paragraph>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-paragraph>Setup Progress</s-paragraph>
            <s-heading>{setupCompletePercent}% Complete</s-heading>
          </s-box>
        </s-stack>
      </s-section>

      <s-section heading="Configurators">
        <s-stack direction="inline" gap="base" wrap>
          {configurators.map((c) => (
            <s-box
              key={c.path}
              padding="base"
              borderRadius="base"
              background="subdued"
              minInlineSize="260px"
              style={{ borderTop: `3px solid ${c.color}` }}
            >
              <s-stack direction="inline" gap="tight" alignItems="center">
                <s-icon type={c.icon} size="small"></s-icon>
                <s-heading>{c.title}</s-heading>
              </s-stack>
              <s-paragraph>
                {c.isConfigured ? `${c.totalOptions} option${c.totalOptions === 1 ? "" : "s"} configured` : "No options configured yet"}
              </s-paragraph>
              <s-stack direction="inline" gap="tight">
                <s-button href={c.path} variant="primary">Manage Configurator →</s-button>
                {themeEditorProductTemplateUrl && (
                  <s-button href={themeEditorProductTemplateUrl} target="_blank" variant="secondary">
                    Add to Theme →
                  </s-button>
                )}
              </s-stack>
            </s-box>
          ))}
        </s-stack>
      </s-section>

      <s-section heading="Recent Activity & Production Orders">
        {recentBlueprints.length === 0 ? (
          <s-paragraph>No production blueprints yet — they're generated automatically when a configurator order comes in.</s-paragraph>
        ) : (
          <s-stack direction="block" gap="tight">
            {recentBlueprints.map((b) => (
              <s-box key={b.id} padding="tight" borderWidth="base" borderRadius="base">
                <s-stack direction="inline" gap="base" alignItems="center">
                  <s-stack direction="block" gap="tight" style={{ flex: 1 }}>
                    <s-text>{b.orderName} — {b.productTitle}</s-text>
                    <s-paragraph>
                      {b.customerName} • {b.destination} • {new Date(b.createdAt).toLocaleDateString("en-AU")}
                    </s-paragraph>
                  </s-stack>
                  <s-badge>{formatStatus(b.orderStatus)}</s-badge>
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        )}
        <s-link href="/app/orders">View All Production Orders →</s-link>
      </s-section>

      <s-section slot="aside" heading="Setup & Help">
        <s-paragraph>App Setup: {setupCompletePercent}% Complete</s-paragraph>
        <s-unordered-list>
          {setupChecklist.map((item) => (
            <s-list-item key={item.label}>
              {item.done ? "✅" : "⬜"} {item.label}
            </s-list-item>
          ))}
        </s-unordered-list>
        {themeEditorUrl && (
          <>
            <s-paragraph>Live theme: {mainThemeName}</s-paragraph>
            <s-button href={themeEditorUrl} target="_blank" variant="primary">
              Open Theme Editor →
            </s-button>
          </>
        )}

        {demoVideos.length > 0 && (
          <>
            <s-button command="--show" commandFor="demo-videos-modal" variant="secondary">
              See how to add a configurator block to your theme →
            </s-button>

            <s-modal id="demo-videos-modal" heading="Adding a Configurator Block to Your Theme" size="large">
              {demoVideos.length > 1 && (
                <s-stack direction="inline" gap="tight" style={{ marginBottom: "12px" }}>
                  {demoVideos.map((v: any, i: number) => (
                    <s-button
                      key={v.id}
                      variant={i === activeVideoIndex ? "primary" : "tertiary"}
                      onClick={() => setActiveVideoIndex(i)}
                    >
                      {v.title}
                    </s-button>
                  ))}
                </s-stack>
              )}
              {activeVideo && <DemoVideoPlayer video={activeVideo} />}
              <s-button slot="secondary-actions" command="--hide" commandFor="demo-videos-modal" variant="tertiary">
                Close
              </s-button>
            </s-modal>
          </>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};