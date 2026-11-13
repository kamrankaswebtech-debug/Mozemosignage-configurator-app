import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

// 3D Sign add-ons (sign3d_option, category = "addon"). "Is Free" = shown under
// "Included With Your Order" (always ticked); otherwise an optional, priced add-on.
// Each add-on shows as a card with an icon: an uploaded Image wins, else the chosen built-in
// Icon, else an icon picked automatically from the label.
type Entry = { id: string; label: string; extraPrice: string; isFree: boolean; sortOrder: string; iconKey: string; imageUrl: string };

const ICONS = [
    { value: "", label: "Auto (from label)" },
    { value: "letters", label: "3D letters / logo" },
    { value: "led", label: "LED / light bulb" },
    { value: "power", label: "Power supply / driver" },
    { value: "plug", label: "Plug / wiring" },
    { value: "studs", label: "Mounting studs / spacers" },
    { value: "screws", label: "Screws / hardware" },
    { value: "template", label: "1:1 template" },
    { value: "diagram", label: "Wiring diagram / document" },
    { value: "guide", label: "Guide / book" },
    { value: "waterproof", label: "Waterproof shield" },
    { value: "package", label: "Packaging / box" },
    { value: "tools", label: "Tools / install kit" },
    { value: "star", label: "Star / premium" },
];

// Client-approved "Included With Your Order" list — the same on 3D Illuminated Signs, Event Marquee
// and Infinity Mirror (all three read these sign3d_option add-ons). "Apply standard list" updates the
// matching included add-ons (or creates the missing ones) to exactly this text, icon and order.
// The list is checked in this order (most specific first); each existing add-on is used once.
const STANDARD_INCLUDED = [
    { label: "Wiring/connection diagram", icon: "diagram", match: /diagram|schematic/i },
    { label: "Full-size 1:1 installation template", icon: "template", match: /template|1:1|stencil/i },
    { label: "Installation guide", icon: "guide", match: /guide|manual|instruction/i },
    { label: "Waterproof cable protection for outdoor applications", icon: "waterproof", match: /waterproof|cable protection|weather/i },
    { label: "Secure protective packaging", icon: "package", match: /packag/i },
    { label: "Outdoor/Indoor Power Supply", icon: "power", match: /power|supply|driver|adapter|transformer/i },
    { label: "Mounting screws and hardware", icon: "screws", match: /screw|hardware|fixing/i },
    { label: "Pre-wired electrical connections", icon: "plug", match: /pre-?wired|electric|wiring|connection/i },
    { label: "Premium LED lighting system", icon: "led", match: /\bled\b|lighting/i },
    { label: "Custom-made 3D illuminated letters/logo", icon: "letters", match: /letter|logo/i },
];
// Final card order (2 columns, left to right, as in the client's reference).
const STANDARD_ORDER = [
    "Installation guide",
    "Waterproof cable protection for outdoor applications",
    "Secure protective packaging",
    "Custom-made 3D illuminated letters/logo",
    "Premium LED lighting system",
    "Outdoor/Indoor Power Supply",
    "Pre-wired electrical connections",
    "Mounting screws and hardware",
    "Full-size 1:1 installation template",
    "Wiring/connection diagram",
];
const STANDARD_PRODUCTS = ["3d", "infinity", "marquee"];
// 3D LED Lightbox: only these 8 add-ons (client), in this order on the Lightbox (its order is set on
// the storefront; see sign3d LIGHTBOX_ADDON_ORDER). Every other add-on is hidden from the Lightbox.
const LIGHTBOX_ADDONS = [
    "Installation guide",
    "Waterproof cable protection for outdoor applications",
    "Secure protective packaging",
    "Premium LED lighting system",
    "Wiring/connection diagram",
    "Outdoor/Indoor Power Supply",
    "Pre-wired electrical connections",
    "Mounting screws and hardware",
];
// show_on keys of 3D-family entries; empty show_on = all of them.
const FAMILY_3D = ["3d", "infinity", "marquee", "lightbox"];
const showOnKeys = (value: string) => {
    const t = String(value || "").trim().toLowerCase();
    if (!t) return FAMILY_3D.slice();
    if (t === "none") return [];
    return t.split(",").map((k) => k.trim()).filter(Boolean);
};
const showOnValue = (keys: string[]) => {
    const fam = FAMILY_3D.filter((k) => keys.includes(k));
    const extra = keys.filter((k) => !FAMILY_3D.includes(k));
    if (fam.length === FAMILY_3D.length && !extra.length) return "";
    const list = fam.concat(extra);
    return list.length ? list.join(",") : "none";
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Standard 3-step upload: stagedUploadsCreate -> direct upload -> fileCreate. Returns the File gid.
async function uploadImageFile(admin: any, file: File): Promise<string> {
    const stagedRes = await admin.graphql(
        `#graphql
      mutation Staged($input: [StagedUploadInput!]!) {
        stagedUploadsCreate(input: $input) {
          stagedTargets { url resourceUrl parameters { name value } }
          userErrors { field message }
        }
      }`,
        { variables: { input: [{ filename: file.name, mimeType: file.type || "image/png", httpMethod: "POST", resource: "IMAGE" }] } }
    );
    const stagedData = await stagedRes.json();
    const stagedErrors = stagedData.data?.stagedUploadsCreate?.userErrors;
    if (stagedErrors?.length) throw new Error(stagedErrors[0].message);
    const target = stagedData.data?.stagedUploadsCreate?.stagedTargets?.[0];
    if (!target) throw new Error("Could not prepare the upload.");

    const uploadForm = new FormData();
    target.parameters.forEach((p: any) => uploadForm.append(p.name, p.value));
    uploadForm.append("file", file);
    const uploadRes = await fetch(target.url, { method: "POST", body: uploadForm });
    if (!uploadRes.ok) throw new Error("Image upload failed (" + uploadRes.status + ").");

    const createRes = await admin.graphql(
        `#graphql
      mutation FileCreate($files: [FileCreateInput!]!) {
        fileCreate(files: $files) { files { id } userErrors { field message } }
      }`,
        { variables: { files: [{ originalSource: target.resourceUrl, contentType: "IMAGE", alt: file.name }] } }
    );
    const createData = await createRes.json();
    const createErrors = createData.data?.fileCreate?.userErrors;
    if (createErrors?.length) throw new Error(createErrors[0].message);
    const fileId = createData.data?.fileCreate?.files?.[0]?.id;
    if (!fileId) throw new Error("File was not created.");

    // Wait (max ~7s) until Shopify finishes processing so the storefront URL is ready.
    try {
        for (let i = 0; i < 10; i++) {
            const statusRes = await admin.graphql(
                `#graphql
          query FileStatus($id: ID!) { node(id: $id) { ... on MediaImage { fileStatus } } }`,
                { variables: { id: fileId } }
            );
            const statusData = await statusRes.json();
            const status = statusData.data?.node?.fileStatus;
            if (status === "READY") break;
            if (status === "FAILED") throw new Error("Shopify could not process this image.");
            await sleep(700);
        }
    } catch (err: any) {
        if (String(err?.message || "").includes("could not process")) throw err;
    }
    return fileId;
}

const hasFile = (v: FormDataEntryValue | null): v is File => typeof v === "object" && v !== null && "size" in v && (v as File).size > 0;

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { admin } = await authenticate.admin(request);
    const response = await admin.graphql(
        `#graphql
    query List {
      metaobjects(type: "$app:sign3d_option", first: 250) {
        edges { node { id fields { key value reference { ... on MediaImage { image { url } } } } } }
      }
    }`
    );
    const data = await response.json();
    const all = data.data.metaobjects.edges.map((edge: any) => {
        const f: Record<string, string> = {};
        let imageUrl = "";
        edge.node.fields.forEach((x: any) => {
            f[x.key] = x.value;
            if (x.key === "image" && x.reference?.image?.url) imageUrl = x.reference.image.url;
        });
        return {
            id: edge.node.id,
            label: f.label || "",
            extraPrice: f.extra_price_decimal || "0",
            isFree: f.is_free === "true",
            sortOrder: f.sort_order || "0",
            category: f.category || "",
            iconKey: f.icon_key || "",
            imageUrl,
        };
    });
    const items: Entry[] = all.filter((a: any) => a.category === "addon");
    items.sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder));
    return { items };
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const { admin } = await authenticate.admin(request);
    const formData = await request.formData();
    const intent = formData.get("intent");

    try {
        if (intent === "apply_standard") {
            const res = await admin.graphql(
                `#graphql
      query All { metaobjects(type: "$app:sign3d_option", first: 250) { edges { node { id fields { key value } } } } }`
            );
            const json = await res.json();
            const addons = (json.data?.metaobjects?.edges || [])
                .map((edge: any) => {
                    const f: Record<string, string> = {};
                    edge.node.fields.forEach((x: any) => { f[x.key] = x.value || ""; });
                    return { id: edge.node.id as string, label: f.label || "", category: f.category || "", isFree: f.is_free === "true", showOn: f.show_on || "" };
                })
                .filter((o: any) => o.category === "addon");
            const included = addons.filter((o: any) => o.isFree);
            const used = new Set<string>();
            // Pass 1: exact label matches first, so a renamed item is never taken by another rule.
            const picks = new Map<string, any>();
            STANDARD_INCLUDED.forEach((item) => {
                const exact = included.find((o: any) => !used.has(o.id) && o.label.trim().toLowerCase() === item.label.toLowerCase());
                if (exact) { used.add(exact.id); picks.set(item.label, exact); }
            });
            // Pass 2: keyword matches for the rest.
            STANDARD_INCLUDED.forEach((item) => {
                if (picks.has(item.label)) return;
                const hit = included.find((o: any) => !used.has(o.id) && item.match.test(o.label));
                if (hit) { used.add(hit.id); picks.set(item.label, hit); }
            });
            let updated = 0;
            let created = 0;
            for (const item of STANDARD_INCLUDED) {
                const hit = picks.get(item.label);
                const fields = [
                    { key: "label", value: item.label },
                    { key: "extra_price_decimal", value: "0" },
                    { key: "is_free", value: "true" },
                    { key: "sort_order", value: String(STANDARD_ORDER.indexOf(item.label) + 1) },
                    { key: "category", value: "addon" },
                    { key: "icon_key", value: item.icon },
                ];
                const onLightbox = LIGHTBOX_ADDONS.includes(item.label);
                if (hit) {
                    // Keep where it is shown, but make sure all three products show it, and the
                    // Lightbox only when it is one of its 8 add-ons.
                    const keys = showOnKeys(hit.showOn);
                    STANDARD_PRODUCTS.forEach((k) => { if (!keys.includes(k)) keys.push(k); });
                    const final = onLightbox ? (keys.includes("lightbox") ? keys : keys.concat("lightbox")) : keys.filter((k) => k !== "lightbox");
                    fields.push({ key: "show_on", value: showOnValue(final) });
                    const up = await admin.graphql(
                        `#graphql
      mutation Update($id: ID!, $metaobject: MetaobjectUpdateInput!) {
        metaobjectUpdate(id: $id, metaobject: $metaobject) { metaobject { id } userErrors { field message } }
      }`,
                        { variables: { id: hit.id, metaobject: { fields } } }
                    );
                    const upData = await up.json();
                    const errs = upData.data?.metaobjectUpdate?.userErrors;
                    if (errs?.length) return { error: item.label + ": " + errs[0].message };
                    updated++;
                } else {
                    fields.push({ key: "show_on", value: showOnValue(onLightbox ? STANDARD_PRODUCTS.concat("lightbox") : STANDARD_PRODUCTS) });
                    const cr = await admin.graphql(
                        `#graphql
      mutation Create($metaobject: MetaobjectCreateInput!) {
        metaobjectCreate(metaobject: $metaobject) { metaobject { id } userErrors { field message } }
      }`,
                        { variables: { metaobject: { type: "$app:sign3d_option", fields } } }
                    );
                    const crData = await cr.json();
                    const errs = crData.data?.metaobjectCreate?.userErrors;
                    if (errs?.length) return { error: item.label + ": " + errs[0].message };
                    created++;
                }
            }
            // Every other add-on (included or optional) is hidden from the Lightbox (only 8 there).
            let hiddenLb = 0;
            for (const o of addons) {
                if (used.has(o.id)) continue;
                const keys = showOnKeys(o.showOn);
                if (!keys.includes("lightbox")) continue;
                const up = await admin.graphql(
                    `#graphql
      mutation Update($id: ID!, $metaobject: MetaobjectUpdateInput!) {
        metaobjectUpdate(id: $id, metaobject: $metaobject) { metaobject { id } userErrors { field message } }
      }`,
                    { variables: { id: o.id, metaobject: { fields: [{ key: "show_on", value: showOnValue(keys.filter((k) => k !== "lightbox")) }] } } }
                );
                const upData = await up.json();
                const errs = upData.data?.metaobjectUpdate?.userErrors;
                if (errs?.length) return { error: o.label + ": " + errs[0].message };
                hiddenLb++;
            }
            const others = included.filter((o: any) => !used.has(o.id)).map((o: any) => o.label);
            return {
                success: true,
                message: "Standard list applied: " + updated + " updated, " + created + " added" +
                    (hiddenLb ? ", " + hiddenLb + " other add-on(s) hidden from the Lightbox" : "") + "." +
                    (others.length ? " Other included add-ons kept (delete them below if not wanted): " + others.join(", ") + "." : ""),
            };
        }

        const fields = [
            { key: "label", value: String(formData.get("label") || "") },
            { key: "extra_price_decimal", value: String(formData.get("extraPrice") || "0") },
            { key: "is_free", value: formData.get("isFree") === "on" ? "true" : "false" },
            { key: "sort_order", value: String(formData.get("sortOrder") || "0") },
            { key: "category", value: "addon" },
            { key: "icon_key", value: String(formData.get("iconKey") || "") },
        ];
        const file = formData.get("imageFile");

        if (intent === "create") {
            if (hasFile(file)) fields.push({ key: "image", value: await uploadImageFile(admin, file) });
            const response = await admin.graphql(
                `#graphql
      mutation Create($metaobject: MetaobjectCreateInput!) {
        metaobjectCreate(metaobject: $metaobject) { metaobject { id } userErrors { field message } }
      }`,
                { variables: { metaobject: { type: "$app:sign3d_option", fields } } }
            );
            const data = await response.json();
            const errors = data.data?.metaobjectCreate?.userErrors;
            if (errors?.length) return { error: errors[0].message };
            return { success: true };
        }

        if (intent === "update") {
            const id = String(formData.get("id"));
            // Image is only replaced when a new file is chosen; "Remove image" clears it.
            if (hasFile(file)) fields.push({ key: "image", value: await uploadImageFile(admin, file) });
            else if (formData.get("removeImage") === "on") fields.push({ key: "image", value: "" });
            const response = await admin.graphql(
                `#graphql
      mutation Update($id: ID!, $metaobject: MetaobjectUpdateInput!) {
        metaobjectUpdate(id: $id, metaobject: $metaobject) { metaobject { id } userErrors { field message } }
      }`,
                { variables: { id, metaobject: { fields } } }
            );
            const data = await response.json();
            const errors = data.data?.metaobjectUpdate?.userErrors;
            if (errors?.length) return { error: errors[0].message };
            return { success: true };
        }

        if (intent === "delete") {
            const id = String(formData.get("id"));
            const response = await admin.graphql(
                `#graphql
      mutation Delete($id: ID!) { metaobjectDelete(id: $id) { deletedId userErrors { field message } } }`,
                { variables: { id } }
            );
            const data = await response.json();
            const errors = data.data?.metaobjectDelete?.userErrors;
            if (errors?.length) return { error: errors[0].message };
            return { success: true };
        }
    } catch (err: any) {
        return { error: err?.message || "Something went wrong." };
    }
    return { error: "Unknown action" };
};

function IconSelect({ defaultValue }: { defaultValue: string }) {
    return (
        <select name="iconKey" defaultValue={defaultValue}>
            {ICONS.map((i) => <option key={i.value} value={i.value}>{i.label}</option>)}
        </select>
    );
}

const iconLabel = (value: string) => ICONS.find((i) => i.value === value)?.label || "Auto (from label)";

export default function AddonsPage() {
    const { items } = useLoaderData<typeof loader>();
    const fetcher = useFetcher<typeof action>();
    const shopify = useAppBridge();
    const [editingId, setEditingId] = useState<string | null>(null);
    const isSubmitting = fetcher.state !== "idle";

    useEffect(() => {
        if (fetcher.data && "success" in fetcher.data && fetcher.data.success) {
            shopify.toast.show("message" in fetcher.data && fetcher.data.message ? String(fetcher.data.message) : "Saved successfully", { duration: 8000 });
            setEditingId(null);
        }
        if (fetcher.data && "error" in fetcher.data && fetcher.data.error) {
            shopify.toast.show(fetcher.data.error, { isError: true });
        }
    }, [fetcher.data, shopify]);

    return (
        <s-page heading="3D Sign Add-ons">
            <s-section heading="Add New Add-on">
                <s-link href="/app/3d-signs">← Back to 3D Illuminated Signs</s-link>
                <s-paragraph>
                    Tick "Is Free" for items included with every order (shown as ticked cards under "Included With Your Order").
                    Each card shows an icon: upload an image to use your own, pick a built-in Icon, or leave it on Auto to choose
                    one from the label (e.g. "Installation guide" → book).
                </s-paragraph>
                <fetcher.Form method="post" encType="multipart/form-data">
                    <input type="hidden" name="intent" value="create" />
                    <s-stack direction="inline" gap="base">
                        <input type="text" name="label" placeholder="Label (e.g. Wall Mounting Kit)" required />
                        <input type="number" step="0.01" name="extraPrice" placeholder="Extra Price" defaultValue="0" />
                        <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
                            <input type="checkbox" name="isFree" /> Is Free
                        </label>
                        <input type="number" name="sortOrder" placeholder="Sort Order" defaultValue={items.length + 1} />
                        <IconSelect defaultValue="" />
                        <input type="file" name="imageFile" accept="image/*" />
                        <s-button type="submit" {...(isSubmitting ? { loading: true } : {})}>Add</s-button>
                    </s-stack>
                </fetcher.Form>
            </s-section>

            <s-section heading="Standard Included list (3D Signs, Event Marquee, Infinity Mirror, 3D LED Lightbox)">
                <s-paragraph>
                    One click sets the client-approved "Included With Your Order" cards on all three configurators:{" "}
                    {STANDARD_ORDER.join(" · ")}. Matching included add-ons are renamed / re-ordered (icons set); missing ones
                    are added. The 3D LED Lightbox gets only its 8 add-ons ({LIGHTBOX_ADDONS.join(" · ")}); every other add-on
                    is hidden from the Lightbox. Prices of optional (paid) add-ons are not touched.
                </s-paragraph>
                <fetcher.Form method="post" onSubmit={(e) => { if (!confirm("Apply the standard Included list to 3D Signs, Event Marquee, Infinity Mirror and the 3D LED Lightbox (8 add-ons)?")) e.preventDefault(); }}>
                    <input type="hidden" name="intent" value="apply_standard" />
                    <s-button type="submit" {...(isSubmitting ? { loading: true } : {})}>Apply standard Included list</s-button>
                </fetcher.Form>
            </s-section>

            <s-section heading={`Existing (${items.length})`}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                        <tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
                            <th style={{ padding: "8px" }}>Icon</th>
                            <th style={{ padding: "8px" }}>Label</th>
                            <th style={{ padding: "8px" }}>Extra Price</th>
                            <th style={{ padding: "8px" }}>Is Free</th>
                            <th style={{ padding: "8px" }}>Sort Order</th>
                            <th style={{ padding: "8px" }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {items.map((item) => (
                            <tr key={item.id} style={{ borderBottom: "1px solid #eee" }}>
                                {editingId === item.id ? (
                                    <td colSpan={6} style={{ padding: "8px" }}>
                                        <fetcher.Form method="post" encType="multipart/form-data">
                                            <input type="hidden" name="intent" value="update" />
                                            <input type="hidden" name="id" value={item.id} />
                                            <s-stack direction="inline" gap="base">
                                                <input type="text" name="label" defaultValue={item.label} required />
                                                <input type="number" step="0.01" name="extraPrice" defaultValue={item.extraPrice} />
                                                <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                                    <input type="checkbox" name="isFree" defaultChecked={item.isFree} /> Is Free
                                                </label>
                                                <input type="number" name="sortOrder" defaultValue={item.sortOrder} />
                                                <IconSelect defaultValue={item.iconKey} />
                                                <input type="file" name="imageFile" accept="image/*" />
                                                {item.imageUrl ? (
                                                    <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                                        <input type="checkbox" name="removeImage" /> Remove image
                                                    </label>
                                                ) : null}
                                                <s-button type="submit" {...(isSubmitting ? { loading: true } : {})}>Save</s-button>
                                                <s-button variant="tertiary" onClick={() => setEditingId(null)}>Cancel</s-button>
                                            </s-stack>
                                            <small>Choose a new file only if you want to replace the current image.</small>
                                        </fetcher.Form>
                                    </td>
                                ) : (
                                    <>
                                        <td style={{ padding: "8px" }}>
                                            {item.imageUrl ? (
                                                <img src={item.imageUrl} alt={item.label} style={{ width: 40, height: 40, objectFit: "contain", background: "#111", borderRadius: 4 }} />
                                            ) : (
                                                iconLabel(item.iconKey)
                                            )}
                                        </td>
                                        <td style={{ padding: "8px" }}>{item.label}</td>
                                        <td style={{ padding: "8px" }}>${item.extraPrice}</td>
                                        <td style={{ padding: "8px" }}>{item.isFree ? "Yes" : "No"}</td>
                                        <td style={{ padding: "8px" }}>{item.sortOrder}</td>
                                        <td style={{ padding: "8px" }}>
                                            <s-stack direction="inline" gap="tight">
                                                <s-button variant="tertiary" onClick={() => setEditingId(item.id)}>Edit</s-button>
                                                <fetcher.Form method="post">
                                                    <input type="hidden" name="intent" value="delete" />
                                                    <input type="hidden" name="id" value={item.id} />
                                                    <s-button variant="tertiary" tone="critical" type="submit"
                                                        onClick={(e) => { if (!confirm(`Delete "${item.label}"?`)) e.preventDefault(); }}>
                                                        Delete
                                                    </s-button>
                                                </fetcher.Form>
                                            </s-stack>
                                        </td>
                                    </>
                                )}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </s-section>
        </s-page>
    );
}
