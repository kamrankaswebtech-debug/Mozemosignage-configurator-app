import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

type Entry = { id: string; name: string; cssFontFamily: string; sortOrder: string; fontFileUrl: string };

async function uploadFontFile(admin: any, file: File): Promise<string> {
    const stagedResponse = await admin.graphql(
        `#graphql
    mutation StageFontUpload($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets { url resourceUrl parameters { name value } }
        userErrors { field message }
      }
    }`,
        {
            variables: {
                input: [
                    { filename: file.name, mimeType: file.type || "font/woff2", httpMethod: "POST", resource: "FILE" },
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
    mutation CreateFontFile($files: [FileCreateInput!]!) {
      fileCreate(files: $files) {
        files { id }
        userErrors { field message }
      }
    }`,
        { variables: { files: [{ originalSource: target.resourceUrl, contentType: "FILE" }] } }
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
    query List {
      metaobjects(type: "$app:infinity_font", first: 100) {
        edges {
          node {
            id
            fields {
              key
              value
              reference { ... on GenericFile { url } }
            }
          }
        }
      }
    }`
    );
    const data = await response.json();
    const items: Entry[] = data.data.metaobjects.edges.map((edge: any) => {
        const f: Record<string, any> = {};
        edge.node.fields.forEach((x: any) => {
            f[x.key] = x.key === "font_file" ? (x.reference?.url || "") : x.value;
        });
        return { id: edge.node.id, name: f.name || "", cssFontFamily: f.css_font_family || "", sortOrder: f.sort_order || "0", fontFileUrl: f.font_file || "" };
    });
    items.sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder));
    return { items };
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const { admin } = await authenticate.admin(request);
    const formData = await request.formData();
    const intent = formData.get("intent");
    const fields = [
        { key: "name", value: String(formData.get("name") || "") },
        { key: "css_font_family", value: String(formData.get("cssFontFamily") || "") },
        { key: "sort_order", value: String(formData.get("sortOrder") || "0") },
    ];

    if (intent === "create") {
        const fontFile = formData.get("fontFile") as File | null;
        if (fontFile && fontFile.size > 0) {
            try {
                const fontFileId = await uploadFontFile(admin, fontFile);
                fields.push({ key: "font_file", value: fontFileId });
            } catch (err: any) {
                return { error: "Font file upload failed: " + err.message };
            }
        }

        const response = await admin.graphql(
            `#graphql
      mutation Create($metaobject: MetaobjectCreateInput!) {
        metaobjectCreate(metaobject: $metaobject) { metaobject { id } userErrors { field message } }
      }`,
            { variables: { metaobject: { type: "$app:infinity_font", fields } } }
        );
        const data = await response.json();
        const errors = data.data?.metaobjectCreate?.userErrors;
        if (errors?.length) return { error: errors[0].message };
        return { success: true };
    }

    if (intent === "update") {
        const id = String(formData.get("id"));
        const fontFile = formData.get("fontFile") as File | null;
        if (fontFile && fontFile.size > 0) {
            try {
                const fontFileId = await uploadFontFile(admin, fontFile);
                fields.push({ key: "font_file", value: fontFileId });
            } catch (err: any) {
                return { error: "Font file upload failed: " + err.message };
            }
        }

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
    return { error: "Unknown action" };
};

export default function FontsPage() {
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
        <s-page heading="Fonts">
            <s-section heading="Add New Font">
                <s-link href="/app/infinity-mirror">← Back to Infinity Mirror</s-link>
                <fetcher.Form method="post" encType="multipart/form-data">
                    <input type="hidden" name="intent" value="create" />
                    <s-stack direction="inline" gap="base">
                        <input type="text" name="name" placeholder="Font Name (e.g. Elegant Script)" required />
                        <input type="text" name="cssFontFamily" placeholder="CSS Font Family (e.g. cursive)" required />
                        <input type="file" name="fontFile" accept=".woff2,.woff,.ttf,.otf" />
                        <input type="number" name="sortOrder" placeholder="Sort Order" defaultValue={items.length + 1} />
                        <s-button type="submit" {...(isSubmitting ? { loading: true } : {})}>Add</s-button>
                    </s-stack>
                </fetcher.Form>
            </s-section>

            <s-section heading={`Existing (${items.length})`}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                        <tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
                            <th style={{ padding: "8px" }}>Name</th>
                            <th style={{ padding: "8px" }}>CSS Font Family</th>
                            <th style={{ padding: "8px" }}>Font File</th>
                            <th style={{ padding: "8px" }}>Sort Order</th>
                            <th style={{ padding: "8px" }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {items.map((item) => (
                            <tr key={item.id} style={{ borderBottom: "1px solid #eee" }}>
                                {editingId === item.id ? (
                                    <td colSpan={5} style={{ padding: "8px" }}>
                                        <fetcher.Form method="post" encType="multipart/form-data">
                                            <input type="hidden" name="intent" value="update" />
                                            <input type="hidden" name="id" value={item.id} />
                                            <s-stack direction="inline" gap="base">
                                                <input type="text" name="name" defaultValue={item.name} required />
                                                <input type="text" name="cssFontFamily" defaultValue={item.cssFontFamily} required />
                                                <input type="file" name="fontFile" accept=".woff2,.woff,.ttf,.otf" />
                                                <span style={{ fontSize: "11px", color: "#888" }}>(leave empty to keep current)</span>
                                                <input type="number" name="sortOrder" defaultValue={item.sortOrder} />
                                                <s-button type="submit" {...(isSubmitting ? { loading: true } : {})}>Save</s-button>
                                                <s-button variant="tertiary" onClick={() => setEditingId(null)}>Cancel</s-button>
                                            </s-stack>
                                        </fetcher.Form>
                                    </td>
                                ) : (
                                    <>
                                        <td style={{ padding: "8px" }}>{item.name}</td>
                                        <td style={{ padding: "8px" }}>{item.cssFontFamily}</td>
                                        <td style={{ padding: "8px" }}>{item.fontFileUrl ? "✅ Uploaded" : "—"}</td>
                                        <td style={{ padding: "8px" }}>{item.sortOrder}</td>
                                        <td style={{ padding: "8px" }}>
                                            <s-stack direction="inline" gap="tight">
                                                <s-button variant="tertiary" onClick={() => setEditingId(item.id)}>Edit</s-button>
                                                <fetcher.Form method="post">
                                                    <input type="hidden" name="intent" value="delete" />
                                                    <input type="hidden" name="id" value={item.id} />
                                                    <s-button variant="tertiary" tone="critical" type="submit"
                                                        onClick={(e) => { if (!confirm(`Delete "${item.name}"?`)) e.preventDefault(); }}>
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