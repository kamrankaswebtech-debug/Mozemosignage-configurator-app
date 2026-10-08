import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

// 3D Sign finishes (sign3d_option, category = "finish"). On the storefront these show as visual
// cards under the Front colour, Side colour and Backing colour lists. Which lists a finish
// appears in is set by "Applies To"; which finishes each Illumination Type allows is set on the
// Illumination Type page.
type Entry = {
    id: string;
    handle: string;
    label: string;
    extraPrice: string;
    sortOrder: string;
    surface: string;
    appliesTo: string[];
    imageUrl: string;
};

const SURFACES = [
    { value: "matte_metal", label: "Matte Metal (brushed, non-reflective)" },
    { value: "gloss_metal", label: "Gloss Metal (smooth, highly reflective)" },
    { value: "gloss_acrylic", label: "Gloss Acrylic (smooth, glossy)" },
];

const SLOTS = [
    { value: "front", label: "Front" },
    { value: "side", label: "Side" },
    { value: "backing", label: "Backing panel" },
];

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
        edges { node { id handle fields { key value reference { ... on MediaImage { image { url } } } } } }
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
            handle: edge.node.handle || "",
            label: f.label || "",
            extraPrice: f.extra_price_decimal || "0",
            sortOrder: f.sort_order || "0",
            category: f.category || "",
            surface: f.finish_surface || "",
            appliesTo: String(f.finish_applies_to || "").split(",").map((s) => s.trim()).filter(Boolean),
            imageUrl,
        };
    });
    const items: Entry[] = all.filter((a: any) => a.category === "finish");
    items.sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder));
    return { items };
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const { admin } = await authenticate.admin(request);
    const formData = await request.formData();
    const intent = formData.get("intent");

    try {
        const appliesTo = SLOTS.map((s) => s.value).filter((slot) => formData.get("applies_" + slot) === "on");
        const fields = [
            { key: "label", value: String(formData.get("label") || "") },
            { key: "extra_price_decimal", value: String(formData.get("extraPrice") || "0") },
            { key: "sort_order", value: String(formData.get("sortOrder") || "0") },
            { key: "category", value: "finish" },
            { key: "finish_surface", value: String(formData.get("surface") || "gloss_acrylic") },
            { key: "finish_applies_to", value: appliesTo.join(",") },
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
            // Image is only replaced when a new file is chosen; otherwise the current image stays.
            if (hasFile(file)) fields.push({ key: "image", value: await uploadImageFile(admin, file) });
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

function SurfaceSelect({ defaultValue }: { defaultValue: string }) {
    return (
        <select name="surface" defaultValue={defaultValue || "gloss_acrylic"}>
            {SURFACES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
    );
}

function AppliesToBoxes({ selected }: { selected: string[] }) {
    return (
        <span style={{ display: "inline-flex", gap: 10, alignItems: "center" }}>
            <span>Show under:</span>
            {SLOTS.map((s) => (
                <label key={s.value} style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                    <input type="checkbox" name={"applies_" + s.value} defaultChecked={selected.includes(s.value)} />
                    {s.label}
                </label>
            ))}
        </span>
    );
}

const surfaceLabel = (value: string) => SURFACES.find((s) => s.value === value)?.label.split(" (")[0] || "—";

export default function FinishesPage() {
    const { items } = useLoaderData<typeof loader>();
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
        <s-page heading="Material / Finish">
            <s-section heading="Add New Finish">
                <s-link href="/app/3d-signs">← Back to 3D Illuminated Signs</s-link>
                <s-paragraph>
                    Finishes show as visual cards under the Front colour, Side colour and Backing colour lists of the 3D configurator
                    (e.g. Matte Metal Finish, Gloss Metal Finish, Gloss Acrylic Finish). "Surface" controls how the card and the live
                    preview look; upload an image to use your own photo on the card instead. Which finishes each Illumination Type
                    allows is set on the Illumination Type page.
                </s-paragraph>
                <fetcher.Form method="post" encType="multipart/form-data">
                    <input type="hidden" name="intent" value="create" />
                    <s-stack direction="inline" gap="base">
                        <input type="text" name="label" placeholder="Label (e.g. Matte Metal Finish)" required />
                        <SurfaceSelect defaultValue="matte_metal" />
                        <input type="number" step="0.01" name="extraPrice" placeholder="Extra Price" defaultValue="0" />
                        <input type="number" name="sortOrder" placeholder="Sort Order" defaultValue={items.length + 1} />
                        <AppliesToBoxes selected={["front", "side"]} />
                        <input type="file" name="imageFile" accept="image/*" />
                        <s-button type="submit" {...(isSubmitting ? { loading: true } : {})}>Add</s-button>
                    </s-stack>
                </fetcher.Form>
            </s-section>

            <s-section heading={`Existing (${items.length})`}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                        <tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
                            <th style={{ padding: "8px" }}>Image</th>
                            <th style={{ padding: "8px" }}>Label</th>
                            <th style={{ padding: "8px" }}>Surface</th>
                            <th style={{ padding: "8px" }}>Shown Under</th>
                            <th style={{ padding: "8px" }}>Extra Price</th>
                            <th style={{ padding: "8px" }}>Sort Order</th>
                            <th style={{ padding: "8px" }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {items.map((item) => (
                            <tr key={item.id} style={{ borderBottom: "1px solid #eee" }}>
                                {editingId === item.id ? (
                                    <td colSpan={7} style={{ padding: "8px" }}>
                                        <fetcher.Form method="post" encType="multipart/form-data">
                                            <input type="hidden" name="intent" value="update" />
                                            <input type="hidden" name="id" value={item.id} />
                                            <s-stack direction="inline" gap="base">
                                                <input type="text" name="label" defaultValue={item.label} required />
                                                <SurfaceSelect defaultValue={item.surface} />
                                                <input type="number" step="0.01" name="extraPrice" defaultValue={item.extraPrice} />
                                                <input type="number" name="sortOrder" defaultValue={item.sortOrder} />
                                                <AppliesToBoxes selected={item.appliesTo} />
                                                <input type="file" name="imageFile" accept="image/*" />
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
                                                <img src={item.imageUrl} alt={item.label} style={{ width: 64, height: 48, objectFit: "cover", background: "#111", borderRadius: 4 }} />
                                            ) : (
                                                "—"
                                            )}
                                        </td>
                                        <td style={{ padding: "8px" }}>{item.label}</td>
                                        <td style={{ padding: "8px" }}>{item.surface ? surfaceLabel(item.surface) : "— (set one)"}</td>
                                        <td style={{ padding: "8px" }}>
                                            {item.appliesTo.length ? item.appliesTo.map((s) => SLOTS.find((x) => x.value === s)?.label || s).join(", ") : "Front, Side (default)"}
                                        </td>
                                        <td style={{ padding: "8px" }}>${item.extraPrice}</td>
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
