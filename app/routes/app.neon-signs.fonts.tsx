import { useEffect, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

type FontEntry = {
    id: string;
    handle: string;
    name: string;
    cssFontFamily: string;
    sortOrder: string;
    fontFileUrl: string | null;
    previewImageUrl: string | null;
    isNew: boolean;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { admin } = await authenticate.admin(request);

    const response = await admin.graphql(
        `#graphql
    query ListNeonFonts {
      metaobjects(type: "$app:neon_font", first: 100, sortKey: "display_name") {
        edges {
          node {
            id
            handle
            fields {
              key
              value
              reference {
                ... on GenericFile { url }
                ... on MediaImage { image { url } }
              }
            }
          }
        }
      }
    }`
    );

    const data = await response.json();
    const fonts: FontEntry[] = data.data.metaobjects.edges.map((edge: any) => {
        const fieldMap: Record<string, string> = {};
        let fontFileUrl: string | null = null;
        let previewImageUrl: string | null = null;
        edge.node.fields.forEach((f: any) => {
            fieldMap[f.key] = f.value;
            if (f.key === "font_file" && f.reference?.url) fontFileUrl = f.reference.url;
            if (f.key === "preview_image" && f.reference?.image?.url) previewImageUrl = f.reference.image.url;
        });
        return {
            id: edge.node.id,
            handle: edge.node.handle,
            name: fieldMap.name || "",
            cssFontFamily: fieldMap.css_font_family || "",
            sortOrder: fieldMap.sort_order || "0",
            fontFileUrl,
            previewImageUrl,
            isNew: fieldMap.is_new === "true",
        };
    });

    fonts.sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder));

    return { fonts };
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const { admin } = await authenticate.admin(request);
    const formData = await request.formData();
    const intent = formData.get("intent");

    if (intent === "delete") {
        const id = String(formData.get("id"));
        const response = await admin.graphql(
            `#graphql
      mutation DeleteNeonFont($id: ID!) {
        metaobjectDelete(id: $id) {
          deletedId
          userErrors { field message }
        }
      }`,
            { variables: { id } }
        );
        const data = await response.json();
        const errors = data.data?.metaobjectDelete?.userErrors;
        if (errors?.length) return { error: errors[0].message };
        return { success: true };
    }

    if (intent === "create" || intent === "update") {
        const name = String(formData.get("name") || "");
        const cssFontFamily = String(formData.get("cssFontFamily") || "");
        const sortOrder = String(formData.get("sortOrder") || "0");
        const isNew = formData.get("isNew") === "on";
        const fontFile = formData.get("fontFile") as File | null;
        const previewImage = formData.get("previewImage") as File | null;

        const fields: { key: string; value: string }[] = [
            { key: "name", value: name },
            { key: "css_font_family", value: cssFontFamily },
            { key: "sort_order", value: sortOrder },
            { key: "is_new", value: isNew ? "true" : "false" },
        ];

        // Only upload + attach a font file if the merchant actually selected one this time
        if (fontFile && fontFile.size > 0) {
            const stagedResponse = await admin.graphql(
                `#graphql
        mutation StagedUpload($input: [StagedUploadInput!]!) {
          stagedUploadsCreate(input: $input) {
            stagedTargets { url resourceUrl parameters { name value } }
            userErrors { field message }
          }
        }`,
                {
                    variables: {
                        input: [
                            {
                                resource: "FILE",
                                filename: fontFile.name,
                                mimeType: fontFile.type || "font/woff2",
                                fileSize: String(fontFile.size),
                                httpMethod: "POST",
                            },
                        ],
                    },
                }
            );
            const stagedData = await stagedResponse.json();
            const stagedErrors = stagedData.data?.stagedUploadsCreate?.userErrors;
            if (stagedErrors?.length) return { error: "Font upload failed: " + stagedErrors[0].message };
            const target = stagedData.data?.stagedUploadsCreate?.stagedTargets?.[0];
            if (!target) return { error: "Could not prepare font file upload." };

            const uploadForm = new FormData();
            target.parameters.forEach((p: any) => uploadForm.append(p.name, p.value));
            uploadForm.append("file", fontFile);

            const uploadResponse = await fetch(target.url, { method: "POST", body: uploadForm });
            if (!uploadResponse.ok) return { error: "Font file upload to storage failed." };

            const fileCreateResponse = await admin.graphql(
                `#graphql
        mutation CreateFile($files: [FileCreateInput!]!) {
          fileCreate(files: $files) {
            files { id }
            userErrors { field message }
          }
        }`,
                {
                    variables: {
                        files: [{ originalSource: target.resourceUrl, contentType: "FILE" }],
                    },
                }
            );
            const fileCreateData = await fileCreateResponse.json();
            const fileCreateErrors = fileCreateData.data?.fileCreate?.userErrors;
            if (fileCreateErrors?.length) return { error: "Font file registration failed: " + fileCreateErrors[0].message };
            const fileGid = fileCreateData.data?.fileCreate?.files?.[0]?.id;
            if (fileGid) fields.push({ key: "font_file", value: fileGid });
        }

        // Only upload + attach a preview image if the merchant actually selected one this time
        if (previewImage && previewImage.size > 0) {
            const stagedImageResponse = await admin.graphql(
                `#graphql
        mutation StagedImageUpload($input: [StagedUploadInput!]!) {
          stagedUploadsCreate(input: $input) {
            stagedTargets { url resourceUrl parameters { name value } }
            userErrors { field message }
          }
        }`,
                {
                    variables: {
                        input: [
                            {
                                resource: "IMAGE",
                                filename: previewImage.name,
                                mimeType: previewImage.type || "image/png",
                                fileSize: String(previewImage.size),
                                httpMethod: "POST",
                            },
                        ],
                    },
                }
            );
            const stagedImageData = await stagedImageResponse.json();
            const stagedImageErrors = stagedImageData.data?.stagedUploadsCreate?.userErrors;
            if (stagedImageErrors?.length) return { error: "Preview image upload failed: " + stagedImageErrors[0].message };
            const imageTarget = stagedImageData.data?.stagedUploadsCreate?.stagedTargets?.[0];
            if (!imageTarget) return { error: "Could not prepare preview image upload." };

            const uploadImageForm = new FormData();
            imageTarget.parameters.forEach((p: any) => uploadImageForm.append(p.name, p.value));
            uploadImageForm.append("file", previewImage);

            const uploadImageResponse = await fetch(imageTarget.url, { method: "POST", body: uploadImageForm });
            if (!uploadImageResponse.ok) return { error: "Preview image upload to storage failed." };

            const imageCreateResponse = await admin.graphql(
                `#graphql
        mutation CreateImageFile($files: [FileCreateInput!]!) {
          fileCreate(files: $files) {
            files { id }
            userErrors { field message }
          }
        }`,
                {
                    variables: {
                        files: [{ originalSource: imageTarget.resourceUrl, contentType: "IMAGE" }],
                    },
                }
            );
            const imageCreateData = await imageCreateResponse.json();
            const imageCreateErrors = imageCreateData.data?.fileCreate?.userErrors;
            if (imageCreateErrors?.length) return { error: "Preview image registration failed: " + imageCreateErrors[0].message };
            const imageGid = imageCreateData.data?.fileCreate?.files?.[0]?.id;
            if (imageGid) fields.push({ key: "preview_image", value: imageGid });
        }

        if (intent === "create") {
            const response = await admin.graphql(
                `#graphql
        mutation CreateNeonFont($metaobject: MetaobjectCreateInput!) {
          metaobjectCreate(metaobject: $metaobject) {
            metaobject { id }
            userErrors { field message }
          }
        }`,
                { variables: { metaobject: { type: "$app:neon_font", fields } } }
            );
            const data = await response.json();
            const errors = data.data?.metaobjectCreate?.userErrors;
            if (errors?.length) return { error: errors[0].message };
            return { success: true };
        }

        const id = String(formData.get("id"));
        const response = await admin.graphql(
            `#graphql
      mutation UpdateNeonFont($id: ID!, $metaobject: MetaobjectUpdateInput!) {
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

    return { error: "Unknown action" };
};

export default function NeonFontsPage() {
    const { fonts } = useLoaderData<typeof loader>();
    const fetcher = useFetcher<typeof action>();
    const shopify = useAppBridge();
    const revalidator = useRevalidator();
    const [editingId, setEditingId] = useState<string | null>(null);
    const createFileInputRef = useRef<HTMLInputElement>(null);
    const createPreviewImageInputRef = useRef<HTMLInputElement>(null);

    const isSubmitting = fetcher.state !== "idle";

    useEffect(() => {
        if (fetcher.data && "success" in fetcher.data && fetcher.data.success) {
            shopify.toast.show("Saved successfully");
            setEditingId(null);
            if (createFileInputRef.current) createFileInputRef.current.value = "";
            if (createPreviewImageInputRef.current) createPreviewImageInputRef.current.value = "";
            // Shopify's metaobject write can take a moment to propagate to reads —
            // re-fetch the list shortly after so the new/edited font shows up without a manual refresh
            setTimeout(() => revalidator.revalidate(), 800);
        }
        if (fetcher.data && "error" in fetcher.data && fetcher.data.error) {
            shopify.toast.show(fetcher.data.error, { isError: true });
        }
    }, [fetcher.data, shopify]);

    return (
        <s-page heading="Neon Fonts">
            <s-section heading="Add New Font">
                <s-link href="/app/neon-signs">← Back to Neon Signs</s-link>

                <fetcher.Form method="post" encType="multipart/form-data">
                    <input type="hidden" name="intent" value="create" />
                    <s-stack direction="inline" gap="base">
                        <input type="text" name="name" placeholder="Display Name (e.g. Barcelon)" required />
                        <input type="text" name="cssFontFamily" placeholder="CSS Font Family fallback (e.g. Dancing Script)" required />
                        <input type="number" name="sortOrder" placeholder="Sort Order" defaultValue={fonts.length + 1} />
                        <label style={{ display: "flex", flexDirection: "column", fontSize: "12px", color: "#666" }}>
                            Font File (optional)
                            <input ref={createFileInputRef} type="file" name="fontFile" accept=".woff2,.woff,.ttf,.otf" />
                        </label>
                        <label style={{ display: "flex", flexDirection: "column", fontSize: "12px", color: "#666" }}>
                            Preview Image (optional)
                            <input ref={createPreviewImageInputRef} type="file" name="previewImage" accept="image/*" />
                        </label>
                        <label style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "13px" }}>
                            <input type="checkbox" name="isNew" />
                            Mark as New
                        </label>
                        <s-button type="submit" {...(isSubmitting ? { loading: true } : {})}>
                            Add Font
                        </s-button>
                    </s-stack>
                    <p style={{ fontSize: "12px", color: "#666", marginTop: "4px" }}>
                        Uploading a real font file (.woff2/.ttf/.otf) is optional — if uploaded, it's used in the live preview instead of the CSS Font Family fallback above. The preview image is shown on the storefront font-picker card; leave empty to show a plain text sample instead.
                    </p>
                </fetcher.Form>


            </s-section>

            <s-section heading={`Existing Fonts (${fonts.length})`}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                        <tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
                            <th style={{ padding: "8px" }}>Name</th>
                            <th style={{ padding: "8px" }}>CSS Font Family</th>
                            <th style={{ padding: "8px" }}>Preview Image</th>
                            <th style={{ padding: "8px" }}>Font File</th>
                            <th style={{ padding: "8px" }}>New</th>
                            <th style={{ padding: "8px" }}>Sort Order</th>
                            <th style={{ padding: "8px" }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {fonts.map((font) => (
                            <tr key={font.id} style={{ borderBottom: "1px solid #eee" }}>
                                {editingId === font.id ? (
                                    <td colSpan={7} style={{ padding: "8px" }}>
                                        <fetcher.Form method="post" encType="multipart/form-data">
                                            <input type="hidden" name="intent" value="update" />
                                            <input type="hidden" name="id" value={font.id} />
                                            <s-stack direction="inline" gap="base">
                                                <input type="text" name="name" defaultValue={font.name} required />
                                                <input type="text" name="cssFontFamily" defaultValue={font.cssFontFamily} required />
                                                <input type="number" name="sortOrder" defaultValue={font.sortOrder} />
                                                <label style={{ display: "flex", flexDirection: "column", fontSize: "12px", color: "#666" }}>
                                                    Font File
                                                    <input type="file" name="fontFile" accept=".woff2,.woff,.ttf,.otf" />
                                                </label>
                                                <label style={{ display: "flex", flexDirection: "column", fontSize: "12px", color: "#666" }}>
                                                    Preview Image
                                                    <input type="file" name="previewImage" accept="image/*" />
                                                </label>
                                                <label style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "13px" }}>
                                                    <input type="checkbox" name="isNew" defaultChecked={font.isNew} />
                                                    Mark as New
                                                </label>
                                                <s-button type="submit" {...(isSubmitting ? { loading: true } : {})}>
                                                    Save
                                                </s-button>
                                                <s-button variant="tertiary" onClick={() => setEditingId(null)}>
                                                    Cancel
                                                </s-button>
                                            </s-stack>
                                            <p style={{ fontSize: "12px", color: "#666", marginTop: "4px" }}>
                                                Leave file/image empty to keep the current one. Choose a new file to replace it.
                                            </p>
                                        </fetcher.Form>
                                    </td>
                                ) : (
                                    <>
                                        <td style={{ padding: "8px" }}>{font.name}</td>
                                        <td style={{ padding: "8px" }}>{font.cssFontFamily}</td>
                                        <td style={{ padding: "8px" }}>
                                            {font.previewImageUrl ? (
                                                <img src={font.previewImageUrl} alt={font.name} style={{ height: "32px", maxWidth: "80px", objectFit: "contain" }} />
                                            ) : (
                                                <span style={{ color: "#999" }}>None</span>
                                            )}
                                        </td>
                                        <td style={{ padding: "8px" }}>
                                            {font.fontFileUrl ? (
                                                <a href={font.fontFileUrl} target="_blank" rel="noreferrer">Uploaded ✓</a>
                                            ) : (
                                                <span style={{ color: "#999" }}>Not uploaded</span>
                                            )}
                                        </td>
                                        <td style={{ padding: "8px" }}>{font.isNew ? "✓" : ""}</td>
                                        <td style={{ padding: "8px" }}>{font.sortOrder}</td>
                                        <td style={{ padding: "8px" }}>
                                            <s-stack direction="inline" gap="tight">
                                                <s-button variant="tertiary" onClick={() => setEditingId(font.id)}>
                                                    Edit
                                                </s-button>
                                                <fetcher.Form method="post">
                                                    <input type="hidden" name="intent" value="delete" />
                                                    <input type="hidden" name="id" value={font.id} />
                                                    <s-button
                                                        variant="tertiary"
                                                        tone="critical"
                                                        type="submit"
                                                        onClick={(e) => {
                                                            if (!confirm(`Delete font "${font.name}"?`)) e.preventDefault();
                                                        }}
                                                    >
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