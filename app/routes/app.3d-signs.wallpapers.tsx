import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

const CATEGORY = "wallpaper";

type WallpaperEntry = {
    id: string;
    label: string;
    imageUrl: string;
    sortOrder: string;
};

// Uploads a file to Shopify Files via the 3-step staged upload process,
// returns the new file's GID (used as the value for a file_reference metaobject field).
async function uploadWallpaperFile(admin: any, file: File): Promise<string> {
    const stagedResponse = await admin.graphql(
        `#graphql
    mutation StageWallpaperUpload($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets { url resourceUrl parameters { name value } }
        userErrors { field message }
      }
    }`,
        {
            variables: {
                input: [
                    {
                        filename: file.name,
                        mimeType: file.type || "image/jpeg",
                        httpMethod: "POST",
                        resource: "FILE",
                    },
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
    mutation CreateWallpaperFile($files: [FileCreateInput!]!) {
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
    query ListSign3dWallpapers {
      metaobjects(type: "$app:sign3d_option", first: 100) {
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
    const wallpapers: WallpaperEntry[] = data.data.metaobjects.edges
        .map((edge: any) => {
            const f: Record<string, any> = {};
            edge.node.fields.forEach((x: any) => {
                f[x.key] = x.key === "image" ? (x.reference?.image?.url || "") : x.value;
            });
            return {
                id: edge.node.id,
                category: f.category,
                label: f.label || "",
                imageUrl: f.image || "",
                sortOrder: f.sort_order || "0",
            };
        })
        .filter((item: any) => item.category === CATEGORY);
    wallpapers.sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder));
    return { wallpapers };
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
            imageFileId = await uploadWallpaperFile(admin, imageFile);
        } catch (err: any) {
            return { error: "Image upload failed: " + err.message };
        }

        const response = await admin.graphql(
            `#graphql
      mutation CreateSign3dWallpaper($metaobject: MetaobjectCreateInput!) {
        metaobjectCreate(metaobject: $metaobject) {
          metaobject { id }
          userErrors { field message }
        }
      }`,
            {
                variables: {
                    metaobject: {
                        type: "$app:sign3d_option",
                        fields: [
                            { key: "category", value: CATEGORY },
                            { key: "label", value: label },
                            { key: "image", value: imageFileId },
                            { key: "sort_order", value: sortOrder },
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
            { key: "category", value: CATEGORY },
            { key: "label", value: label },
            { key: "sort_order", value: sortOrder },
        ];

        if (imageFile && imageFile.size > 0) {
            try {
                const imageFileId = await uploadWallpaperFile(admin, imageFile);
                fields.push({ key: "image", value: imageFileId });
            } catch (err: any) {
                return { error: "Image upload failed: " + err.message };
            }
        }

        const response = await admin.graphql(
            `#graphql
      mutation UpdateSign3dWallpaper($id: ID!, $metaobject: MetaobjectUpdateInput!) {
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
      mutation DeleteSign3dWallpaper($id: ID!) {
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

export default function Sign3dWallpapersPage() {
    const { wallpapers } = useLoaderData<typeof loader>();
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
        <s-page heading="3D Sign Wallpapers">
            <s-section heading="Add New Wallpaper">
                <s-link href="/app/3d-signs">← Back to 3D Illuminated Signs</s-link>
                <s-paragraph>
                    The first wallpaper (lowest Sort Order) is shown by default on the storefront. Customers can switch between the wallpapers you upload here.
                </s-paragraph>
                <fetcher.Form method="post" encType="multipart/form-data">
                    <input type="hidden" name="intent" value="create" />
                    <s-stack direction="inline" gap="base">
                        <input type="text" name="label" placeholder="Label (e.g. Store Front)" required />
                        <input type="file" name="image" accept="image/*" required />
                        <input type="number" name="sortOrder" placeholder="Sort Order" defaultValue={wallpapers.length + 1} />
                        <s-button type="submit" {...(isSubmitting ? { loading: true } : {})}>Add Wallpaper</s-button>
                    </s-stack>
                </fetcher.Form>
            </s-section>

            <s-section heading={`Existing Wallpapers (${wallpapers.length})`}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                        <tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
                            <th style={{ padding: "8px" }}>Preview</th>
                            <th style={{ padding: "8px" }}>Label</th>
                            <th style={{ padding: "8px" }}>Sort Order</th>
                            <th style={{ padding: "8px" }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {wallpapers.map((w) => (
                            <tr key={w.id} style={{ borderBottom: "1px solid #eee" }}>
                                {editingId === w.id ? (
                                    <td colSpan={4} style={{ padding: "8px" }}>
                                        <fetcher.Form method="post" encType="multipart/form-data">
                                            <input type="hidden" name="intent" value="update" />
                                            <input type="hidden" name="id" value={w.id} />
                                            <s-stack direction="inline" gap="base">
                                                <input type="text" name="label" defaultValue={w.label} required />
                                                <input type="file" name="image" accept="image/*" />
                                                <span style={{ fontSize: "11px", color: "#888" }}>(leave empty to keep current image)</span>
                                                <input type="number" name="sortOrder" defaultValue={w.sortOrder} />
                                                <s-button type="submit" {...(isSubmitting ? { loading: true } : {})}>Save</s-button>
                                                <s-button variant="tertiary" onClick={() => setEditingId(null)}>Cancel</s-button>
                                            </s-stack>
                                        </fetcher.Form>
                                    </td>
                                ) : (
                                    <>
                                        <td style={{ padding: "8px" }}>
                                            {w.imageUrl ? <img src={w.imageUrl} alt={w.label} width={80} height={60} style={{ objectFit: "cover", borderRadius: "4px" }} /> : "—"}
                                        </td>
                                        <td style={{ padding: "8px" }}>{w.label}</td>
                                        <td style={{ padding: "8px" }}>{w.sortOrder}</td>
                                        <td style={{ padding: "8px" }}>
                                            <s-stack direction="inline" gap="tight">
                                                <s-button variant="tertiary" onClick={() => setEditingId(w.id)}>Edit</s-button>
                                                <fetcher.Form method="post">
                                                    <input type="hidden" name="intent" value="delete" />
                                                    <input type="hidden" name="id" value={w.id} />
                                                    <s-button variant="tertiary" tone="critical" type="submit"
                                                        onClick={(e) => { if (!confirm(`Delete "${w.label}"?`)) e.preventDefault(); }}>
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