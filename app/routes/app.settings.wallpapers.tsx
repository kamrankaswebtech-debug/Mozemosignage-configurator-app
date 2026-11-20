import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

// Wallpaper library for the shared configurators (Infinity Mirror, Event Marquee, Lightbox,
// Acrylic Bonnet). "products" = comma list of the configurators a photo is shown on.
const PRODUCTS = [
    { value: "infinity", label: "Infinity Mirror" },
    { value: "marquee", label: "Event Marquee" },
    { value: "lightbox", label: "Lightbox" },
    { value: "bonnet", label: "Acrylic Bonnet" },
];
const readProducts = (formData: FormData) => formData.getAll("products").map(String).filter((p) => PRODUCTS.some((x) => x.value === p)).join(",");
// Sign placement on the photo (Event Marquee / Infinity Mirror live preview), % of the photo height
// from the top: floor line (freestanding sign stands on it), wall-mounted sign centre and the
// tallest a wall-mounted sign may be. Empty = automatic.
const PLACEMENT = [
    { key: "floor_percent", name: "floorPercent", label: "Floor line %", hint: "freestanding sign stands here" },
    { key: "wall_percent", name: "wallPercent", label: "Wall sign centre %", hint: "wall-mounted sign centre" },
    { key: "wall_height_percent", name: "wallHeightPercent", label: "Wall sign max height %", hint: "optional limit" },
] as const;
// Infinity Mirror Text Only: which mounting choice shows this wallpaper ("" = always).
// Stored as "infinity=floor;marquee=floor" (a plain "floor" / "wall" = Infinity Mirror only).
const MODE_PRODUCTS = [{ key: "infinity", name: "mountModeInf", label: "Infinity Text display" }, { key: "marquee", name: "mountModeMq", label: "Event Marquee display" }] as const;
const parseMountMode = (v: string, key: string) => {
    const t = String(v || "");
    if (t.indexOf("=") < 0) return key === "infinity" ? t : "";
    const hit = t.split(/[;,]/).map((p) => p.split("=")).find((p) => p[0].trim() === key);
    return hit ? String(hit[1] || "").trim() : "";
};
const readMountMode = (formData: FormData) => MODE_PRODUCTS
    .map((p) => { const v = String(formData.get(p.name) || ""); return v === "floor" || v === "wall" ? p.key + "=" + v : ""; })
    .filter(Boolean).join(";");
const MountModeSelect = ({ value }: { value: string }) => (
    <>
        {MODE_PRODUCTS.map((p) => (
            <label key={p.key} style={{ display: "flex", alignItems: "center", gap: 4 }}>{p.label}
                <select name={p.name} defaultValue={parseMountMode(value, p.key)}>
                    <option value="">Always</option>
                    <option value="floor">No Mounting only (floor)</option>
                    <option value="wall">Mounting only (wall / sign panel)</option>
                </select>
            </label>
        ))}
    </>
);
const readPlacement = (formData: FormData) => PLACEMENT.map((p) => {
    const n = parseFloat(String(formData.get(p.name) || ""));
    return { key: p.key, value: Number.isFinite(n) && n > 0 && n < 100 ? String(Math.round(n * 10) / 10) : "" };
});

type BgEntry = {
    id: string;
    label: string;
    imageUrl: string;
    sortOrder: string;
    products: string;
    floorPercent: string;
    wallPercent: string;
    wallHeightPercent: string;
    mountMode: string;
};

async function uploadBgImage(admin: any, file: File): Promise<string> {
    const stagedResponse = await admin.graphql(
        `#graphql
    mutation StageBgUpload($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets { url resourceUrl parameters { name value } }
        userErrors { field message }
      }
    }`,
        {
            variables: {
                input: [
                    { filename: file.name, mimeType: file.type || "image/jpeg", httpMethod: "POST", resource: "IMAGE" },
                ],
            },
        }
    );
    const stagedData = await stagedResponse.json();
    const stagedErrors = stagedData.data?.stagedUploadsCreate?.userErrors;
    if (stagedErrors?.length) throw new Error(stagedErrors[0].message);

    const target = stagedData.data.stagedUploadsCreate.stagedTargets[0];
    const uploadForm = new FormData();
    target.parameters.forEach((p: any) => uploadForm.append(p.name, p.value));
    uploadForm.append("file", file);

    const uploadResponse = await fetch(target.url, { method: "POST", body: uploadForm });
    if (!uploadResponse.ok) throw new Error("File upload to staged URL failed");

    const fileCreateResponse = await admin.graphql(
        `#graphql
    mutation CreateBgImageFile($files: [FileCreateInput!]!) {
      fileCreate(files: $files) {
        files { id }
        userErrors { field message }
      }
    }`,
        { variables: { files: [{ originalSource: target.resourceUrl, contentType: "IMAGE" }] } }
    );
    const fileCreateData = await fileCreateResponse.json();
    const fileErrors = fileCreateData.data?.fileCreate?.userErrors;
    if (fileErrors?.length) throw new Error(fileErrors[0].message);

    return fileCreateData.data.fileCreate.files[0].id;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { admin } = await authenticate.admin(request);
    const response = await admin.graphql(
        `#graphql
    query ListConfiguratorWallpapers {
      metaobjects(type: "$app:lightbox_option", first: 250) {
        edges {
          node {
            id
            fields {
              key
              value
              reference { ... on MediaImage { image { url } } }
            }
          }
        }
      }
    }`
    );
    const data = await response.json();
    const allEntries = data.data.metaobjects.edges.map((edge: any) => {
        const f: Record<string, any> = {};
        edge.node.fields.forEach((x: any) => {
            f[x.key] = x.key === "image" ? (x.reference?.image?.url || "") : x.value;
        });
        return {
            id: edge.node.id,
            label: f.label || "",
            imageUrl: f.image || "",
            sortOrder: f.sort_order || "0",
            products: f.products || "",
            category: f.category || "",
            floorPercent: f.floor_percent || "",
            wallPercent: f.wall_percent || "",
            wallHeightPercent: f.wall_height_percent || "",
            mountMode: f.mount_mode || "",
        };
    });
    const images: BgEntry[] = allEntries.filter((entry: any) => entry.category === "wallpaper");
    images.sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder));
    return { images };
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const { admin } = await authenticate.admin(request);
    const formData = await request.formData();
    const intent = formData.get("intent");

    if (intent === "create") {
        const label = String(formData.get("label") || "");
        const sortOrder = String(formData.get("sortOrder") || "0");
        const imageFile = formData.get("image") as File | null;

        if (!imageFile || imageFile.size === 0) {
            return { error: "Please select an image file" };
        }

        let imageFileId: string;
        try {
            imageFileId = await uploadBgImage(admin, imageFile);
        } catch (err: any) {
            return { error: "Image upload failed: " + err.message };
        }

        const response = await admin.graphql(
            `#graphql
      mutation CreateBgImage($metaobject: MetaobjectCreateInput!) {
        metaobjectCreate(metaobject: $metaobject) {
          metaobject { id }
          userErrors { field message }
        }
      }`,
            {
                variables: {
                    metaobject: {
                        type: "$app:lightbox_option",
                        fields: [
                            { key: "label", value: label },
                            { key: "image", value: imageFileId },
                            { key: "category", value: "wallpaper" },
                            { key: "sort_order", value: sortOrder },
                            { key: "products", value: readProducts(formData) },
                            ...readPlacement(formData).filter((p) => p.value),
                            ...(readMountMode(formData) ? [{ key: "mount_mode", value: readMountMode(formData) }] : []),
                        ],
                    },
                },
            }
        );
        const data = await response.json();
        const errors = data.data?.metaobjectCreate?.userErrors;
        if (errors?.length) return { error: errors[0].message };
        return { success: true };
    }

    if (intent === "update") {
        const id = String(formData.get("id"));
        const label = String(formData.get("label") || "");
        const sortOrder = String(formData.get("sortOrder") || "0");
        const imageFile = formData.get("image") as File | null;

        const fields: { key: string; value: string }[] = [
            { key: "label", value: label },
            { key: "sort_order", value: sortOrder },
            { key: "products", value: readProducts(formData) },
            ...readPlacement(formData),
            { key: "mount_mode", value: readMountMode(formData) },
        ];

        if (imageFile && imageFile.size > 0) {
            try {
                const imageFileId = await uploadBgImage(admin, imageFile);
                fields.push({ key: "image", value: imageFileId });
            } catch (err: any) {
                return { error: "Image upload failed: " + err.message };
            }
        }

        const response = await admin.graphql(
            `#graphql
      mutation UpdateBgImage($id: ID!, $metaobject: MetaobjectUpdateInput!) {
        metaobjectUpdate(id: $id, metaobject: $metaobject) {
          metaobject { id }
          userErrors { field message }
        }
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
      mutation DeleteBgImage($id: ID!) {
        metaobjectDelete(id: $id) { deletedId userErrors { field message } }
      }`,
            { variables: { id } }
        );
        const data = await response.json();
        const errors = data.data?.metaobjectDelete?.userErrors;
        if (errors?.length) return { error: errors[0].message };
        return { success: true };
    }

    return { error: "Unknown action" };
};

export default function ConfiguratorWallpapersPage() {
    const { images } = useLoaderData<typeof loader>();
    const fetcher = useFetcher<typeof action>();
    const shopify = useAppBridge();
    const [editingId, setEditingId] = useState<string | null>(null);
    const isSubmitting = fetcher.state !== "idle";

    useEffect(() => {
        if (fetcher.data && "success" in fetcher.data && fetcher.data.success) {
            shopify.toast.show("Saved successfully");
            setEditingId(null);
        }
        if (fetcher.data && "error" in fetcher.data && fetcher.data.error) {
            shopify.toast.show(fetcher.data.error, { isError: true });
        }
    }, [fetcher.data, shopify]);

    return (
        <s-page heading="Configurator Wallpapers">
            <s-section heading="Add New Background Image">
                <s-link href="/app/settings">← Back to Settings</s-link>
                <s-paragraph>Wallpapers for the Infinity Mirror, Event Marquee, Lightbox and Acrylic Bonnet configurators. Tick the configurators each photo is shown on; the lowest Sort Order is the default. (Neon and UV Graphic use the Neon Background Images; 3D uses its own.)</s-paragraph>
                <s-paragraph>
                    Sign placement (Event Marquee / Infinity Mirror): % of the photo's height, measured from the top. "Floor line" = where a
                    freestanding sign stands (e.g. the line where the wall meets the floor); "Wall sign centre" = where the middle of a
                    wall-mounted sign sits; "Wall sign max height" = optional, for a small sign area (e.g. a panel above a door). Leave empty
                    for automatic (floor line found from the photo, sign centre half way up the wall).
                </s-paragraph>
                <fetcher.Form method="post" encType="multipart/form-data">
                    <input type="hidden" name="intent" value="create" />
                    <s-stack direction="inline" gap="base">
                        <input type="text" name="label" placeholder="Label (e.g. Living Room)" required />
                        <input type="file" name="image" accept="image/*" required />
                        <input type="number" name="sortOrder" placeholder="Sort Order" defaultValue={images.length + 1} />
                        {PRODUCTS.map((p) => (<label key={p.value} style={{ display: "flex", alignItems: "center", gap: 4 }}><input type="checkbox" name="products" value={p.value} defaultChecked={true} /> {p.label}</label>))}
                        {PLACEMENT.map((p) => (<label key={p.key} style={{ display: "flex", alignItems: "center", gap: 4 }} title={p.hint}>{p.label} <input type="number" step="0.1" min="0" max="99" name={p.name} style={{ width: 70 }} /></label>))}
                        <MountModeSelect value="" />
                        <s-button type="submit" {...(isSubmitting ? { loading: true } : {})}>Add Image</s-button>
                    </s-stack>
                </fetcher.Form>
            </s-section>

            <s-section heading={`Existing Images (${images.length})`}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                        <tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
                            <th style={{ padding: "8px" }}>Preview</th>
                            <th style={{ padding: "8px" }}>Label</th>
                            <th style={{ padding: "8px" }}>Sort Order</th>
                            <th style={{ padding: "8px" }}>Shown On</th>
                            <th style={{ padding: "8px" }}>Sign placement</th>
                            <th style={{ padding: "8px" }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {images.map((img) => (
                            <tr key={img.id} style={{ borderBottom: "1px solid #eee" }}>
                                {editingId === img.id ? (
                                    <td colSpan={6} style={{ padding: "8px" }}>
                                        <fetcher.Form method="post" encType="multipart/form-data">
                                            <input type="hidden" name="intent" value="update" />
                                            <input type="hidden" name="id" value={img.id} />
                                            <s-stack direction="inline" gap="base">
                                                <input type="text" name="label" defaultValue={img.label} required />
                                                <input type="file" name="image" accept="image/*" />
                                                <span style={{ fontSize: "11px", color: "#888" }}>(leave empty to keep current image)</span>
                                                <input type="number" name="sortOrder" defaultValue={img.sortOrder} />
                                                {PRODUCTS.map((p) => (<label key={p.value} style={{ display: "flex", alignItems: "center", gap: 4 }}><input type="checkbox" name="products" value={p.value} defaultChecked={img.products.split(",").includes(p.value)} /> {p.label}</label>))}
                                                {PLACEMENT.map((p) => (<label key={p.key} style={{ display: "flex", alignItems: "center", gap: 4 }} title={p.hint}>{p.label} <input type="number" step="0.1" min="0" max="99" name={p.name} style={{ width: 70 }} defaultValue={(img as any)[p.name] || ""} /></label>))}
                                                <MountModeSelect value={img.mountMode} />
                                                <s-button type="submit" {...(isSubmitting ? { loading: true } : {})}>Save</s-button>
                                                <s-button variant="tertiary" onClick={() => setEditingId(null)}>Cancel</s-button>
                                            </s-stack>
                                        </fetcher.Form>
                                    </td>
                                ) : (
                                    <>
                                        <td style={{ padding: "8px" }}>
                                            {img.imageUrl ? <img src={img.imageUrl} alt={img.label} width={60} height={45} style={{ objectFit: "cover", borderRadius: 4 }} /> : "—"}
                                        </td>
                                        <td style={{ padding: "8px" }}>{img.label}</td>
                                        <td style={{ padding: "8px" }}>{img.sortOrder}</td>
                                        <td style={{ padding: "8px" }}>{img.products ? img.products.split(",").map((v) => PRODUCTS.find((p) => p.value === v)?.label || v).join(", ") : "Not assigned"}</td>
                                        <td style={{ padding: "8px", fontSize: 12 }}>
                                            Floor {img.floorPercent ? img.floorPercent + "%" : "auto"} · Wall {img.wallPercent ? img.wallPercent + "%" : "auto"}{img.wallHeightPercent ? " · max " + img.wallHeightPercent + "%" : ""}{MODE_PRODUCTS.map((p) => { const m = parseMountMode(img.mountMode, p.key); return m ? " · " + (p.key === "infinity" ? "Infinity" : "Marquee") + ": " + (m === "floor" ? "No Mounting" : "Mounting") : ""; }).join("")}
                                        </td>
                                        <td style={{ padding: "8px" }}>
                                            <s-stack direction="inline" gap="tight">
                                                <s-button variant="tertiary" onClick={() => setEditingId(img.id)}>Edit</s-button>
                                                <fetcher.Form method="post">
                                                    <input type="hidden" name="intent" value="delete" />
                                                    <input type="hidden" name="id" value={img.id} />
                                                    <s-button variant="tertiary" tone="critical" type="submit"
                                                        onClick={(e) => { if (!confirm(`Delete "${img.label}"?`)) e.preventDefault(); }}>
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