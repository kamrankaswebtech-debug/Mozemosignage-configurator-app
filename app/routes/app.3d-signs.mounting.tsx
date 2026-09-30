import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

type Entry = {
    id: string;
    label: string;
    extraPrice: string;
    sortOrder: string;
    description: string;
    backingType: string;
    imageUrl: string;
};
type Badge = { id: string; imageUrl: string } | null;

const BADGES = [
    { key: "electrician", category: "install_electrician", title: "Electrician Needed badge", label: "Electrician Needed" },
    { key: "easy", category: "install_easy", title: "Easy Install badge", label: "Easy Install" },
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
      metaobjects(type: "$app:sign3d_option", first: 100) {
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
            sortOrder: f.sort_order || "0",
            category: f.category || "",
            description: f.description || "",
            backingType: f.backing_type || "",
            imageUrl,
        };
    });
    const items: Entry[] = all.filter((a: any) => a.category === "mounting");
    items.sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder));

    const badges: Record<string, Badge> = {};
    BADGES.forEach((b) => {
        const found = all.find((a: any) => a.category === b.category);
        badges[b.key] = found ? { id: found.id, imageUrl: found.imageUrl } : null;
    });
    return { items, badges };
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const { admin } = await authenticate.admin(request);
    const formData = await request.formData();
    const intent = formData.get("intent");

    try {
        if (intent === "saveBadge") {
            const badge = BADGES.find((b) => b.key === String(formData.get("badgeKey")));
            if (!badge) return { error: "Unknown badge" };
            const file = formData.get("imageFile");
            if (!hasFile(file)) return { error: "Please choose an image first." };
            const fileId = await uploadImageFile(admin, file);
            const id = String(formData.get("id") || "");

            if (id) {
                const res = await admin.graphql(
                    `#graphql
          mutation Update($id: ID!, $metaobject: MetaobjectUpdateInput!) {
            metaobjectUpdate(id: $id, metaobject: $metaobject) { metaobject { id } userErrors { field message } }
          }`,
                    { variables: { id, metaobject: { fields: [{ key: "image", value: fileId }] } } }
                );
                const d = await res.json();
                const errs = d.data?.metaobjectUpdate?.userErrors;
                if (errs?.length) return { error: errs[0].message };
                return { success: true };
            }
            const res = await admin.graphql(
                `#graphql
        mutation Create($metaobject: MetaobjectCreateInput!) {
          metaobjectCreate(metaobject: $metaobject) { metaobject { id } userErrors { field message } }
        }`,
                {
                    variables: {
                        metaobject: {
                            type: "$app:sign3d_option",
                            fields: [
                                { key: "category", value: badge.category },
                                { key: "label", value: badge.label },
                                { key: "sort_order", value: "0" },
                                { key: "image", value: fileId },
                            ],
                        },
                    },
                }
            );
            const d = await res.json();
            const errs = d.data?.metaobjectCreate?.userErrors;
            if (errs?.length) return { error: errs[0].message };
            return { success: true };
        }

        const baseFields = [
            { key: "label", value: String(formData.get("label") || "") },
            { key: "extra_price_decimal", value: String(formData.get("extraPrice") || "0") },
            { key: "sort_order", value: String(formData.get("sortOrder") || "0") },
            { key: "category", value: "mounting" },
        ];
        const backingType = String(formData.get("backingType") || "");
        const description = String(formData.get("description") || "");
        const file = formData.get("imageFile");

        if (intent === "create") {
            const fields = [...baseFields];
            if (backingType) fields.push({ key: "backing_type", value: backingType });
            if (description) fields.push({ key: "description", value: description });
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
            const fields = [...baseFields, { key: "backing_type", value: backingType }, { key: "description", value: description }];
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

const BACKING_OPTIONS = (
    <>
        <option value="">Auto-detect from label</option>
        <option value="none">none (No Backing Panel)</option>
        <option value="raceway">raceway</option>
        <option value="rectangle">rectangle</option>
        <option value="circle">circle</option>
    </>
);

export default function MountingPage() {
    const { items, badges } = useLoaderData<typeof loader>();
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
        <s-page heading="Mounting">
            <s-section heading="Add New Mounting Type">
                <s-link href="/app/3d-signs">← Back to 3D Illuminated Signs</s-link>
                <s-paragraph>
                    Use 4 entries: No Backing Panel, Raceway, Rectangle Backing Panel and Circle Backing Panel. "Backing Type" controls the
                    preview drawing and the installation / power-supply rules. Leave it on Auto-detect to read it from the label.
                </s-paragraph>
                <fetcher.Form method="post" encType="multipart/form-data">
                    <input type="hidden" name="intent" value="create" />
                    <s-stack direction="inline" gap="base">
                        <input type="text" name="label" placeholder="Label (e.g. Raceway)" required />
                        <input type="number" step="0.01" name="extraPrice" placeholder="Extra Price" defaultValue="0" />
                        <input type="number" name="sortOrder" placeholder="Sort Order" defaultValue={items.length + 1} />
                        <select name="backingType" defaultValue="">{BACKING_OPTIONS}</select>
                        <input type="text" name="description" placeholder="Short description (optional)" />
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
                            <th style={{ padding: "8px" }}>Backing Type</th>
                            <th style={{ padding: "8px" }}>Extra Price</th>
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
                                                <input type="number" name="sortOrder" defaultValue={item.sortOrder} />
                                                <select name="backingType" defaultValue={item.backingType}>{BACKING_OPTIONS}</select>
                                                <input type="text" name="description" defaultValue={item.description} placeholder="Short description" />
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
                                                <img src={item.imageUrl} alt={item.label} style={{ width: 64, height: 48, objectFit: "contain", background: "#111", borderRadius: 4 }} />
                                            ) : (
                                                "—"
                                            )}
                                        </td>
                                        <td style={{ padding: "8px" }}>{item.label}</td>
                                        <td style={{ padding: "8px" }}>{item.backingType || "auto"}</td>
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

            <s-section heading="Installation Notice Images">
                <s-paragraph>
                    "Electrician Needed" shows for No Backing Panel and for any sign wider than 2 metres. "Easy Install" shows for the other mounting
                    options on smaller signs. Upload one image for each.
                </s-paragraph>
                {BADGES.map((b) => {
                    const current = (badges as any)[b.key] as Badge;
                    return (
                        <fetcher.Form key={b.key} method="post" encType="multipart/form-data" style={{ marginBottom: 16 }}>
                            <input type="hidden" name="intent" value="saveBadge" />
                            <input type="hidden" name="badgeKey" value={b.key} />
                            <input type="hidden" name="id" value={current?.id || ""} />
                            <s-stack direction="inline" gap="base">
                                <strong style={{ minWidth: 180 }}>{b.title}</strong>
                                {current?.imageUrl ? (
                                    <img src={current.imageUrl} alt={b.label} style={{ width: 56, height: 56, borderRadius: "50%", objectFit: "cover" }} />
                                ) : (
                                    <span>No image yet</span>
                                )}
                                <input type="file" name="imageFile" accept="image/*" required />
                                <s-button type="submit" {...(isSubmitting ? { loading: true } : {})}>{current ? "Replace" : "Upload"}</s-button>
                            </s-stack>
                        </fetcher.Form>
                    );
                })}
            </s-section>
        </s-page>
    );
}