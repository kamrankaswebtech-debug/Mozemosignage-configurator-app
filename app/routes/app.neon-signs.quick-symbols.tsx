import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

type SymbolEntry = {
    id: string;
    label: string;
    iconUrl: string;
    sortOrder: string;
    visibility: string;
};

// Shared helper: uploads a file to Shopify Files via the 3-step staged upload process,
// returns the new file's GID (used as the value for a file_reference metaobject field).
async function uploadIconFile(admin: any, file: File): Promise<string> {
    const stagedResponse = await admin.graphql(
        `#graphql
    mutation StageIconUpload($input: [StagedUploadInput!]!) {
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
                        mimeType: file.type || "image/svg+xml",
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
    mutation CreateIconFile($files: [FileCreateInput!]!) {
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
    query ListQuickSymbols {
      metaobjects(type: "$app:neon_quick_symbol", first: 100) {
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
    const symbols: SymbolEntry[] = data.data.metaobjects.edges.map((edge: any) => {
        const f: Record<string, any> = {};
        edge.node.fields.forEach((x: any) => {
            f[x.key] = x.key === "icon" ? (x.reference?.url || "") : x.value;
        });
        return {
            id: edge.node.id,
            label: f.label || "",
            iconUrl: f.icon || "",
            sortOrder: f.sort_order || "0",
            visibility: f.visibility || "both",
        };
    });
    symbols.sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder));
    return { symbols };
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const { admin } = await authenticate.admin(request);
    const formData = await request.formData();
    const intent = formData.get("intent");

    if (intent === "create") {
        const label = String(formData.get("label") || "");
        const sortOrder = String(formData.get("sortOrder") || "0");
        const iconFile = formData.get("icon") as File | null;

        if (!iconFile || iconFile.size === 0) {
            return { error: "Please select an SVG icon file" };
        }

        let iconFileId: string;
        try {
            iconFileId = await uploadIconFile(admin, iconFile);
        } catch (err: any) {
            return { error: "Icon upload failed: " + err.message };
        }

        const response = await admin.graphql(
            `#graphql
      mutation CreateQuickSymbol($metaobject: MetaobjectCreateInput!) {
        metaobjectCreate(metaobject: $metaobject) {
          metaobject { id }
          userErrors { field message }
        }
      }`,
            {
                variables: {
                    metaobject: {
                        type: "$app:neon_quick_symbol",
                        fields: [
                            { key: "label", value: label },
                            { key: "icon", value: iconFileId },
                            { key: "sort_order", value: sortOrder },
                            { key: "visibility", value: String(formData.get("visibility") || "both") },
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
        const iconFile = formData.get("icon") as File | null;

        const fields: { key: string; value: string }[] = [
            { key: "label", value: label },
            { key: "sort_order", value: sortOrder },
            { key: "visibility", value: String(formData.get("visibility") || "both") },
        ];

        if (iconFile && iconFile.size > 0) {
            try {
                const iconFileId = await uploadIconFile(admin, iconFile);
                fields.push({ key: "icon", value: iconFileId });
            } catch (err: any) {
                return { error: "Icon upload failed: " + err.message };
            }
        }

        const response = await admin.graphql(
            `#graphql
      mutation UpdateQuickSymbol($id: ID!, $metaobject: MetaobjectUpdateInput!) {
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
      mutation DeleteQuickSymbol($id: ID!) {
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

export default function QuickSymbolsPage() {
    const { symbols } = useLoaderData<typeof loader>();
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
        <s-page heading="Quick Symbols">
            <s-section heading="Add New Symbol">
                <s-link href="/app/neon-signs">← Back to Neon Signs</s-link>
                <fetcher.Form method="post" encType="multipart/form-data">
                    <input type="hidden" name="intent" value="create" />
                    <s-stack direction="inline" gap="base">
                        <input type="text" name="label" placeholder="Label (e.g. Heart)" required />
                        <input type="file" name="icon" accept=".svg,image/svg+xml" required />
                        <input type="number" name="sortOrder" placeholder="Sort Order" defaultValue={symbols.length + 1} />
                        <select name="visibility" defaultValue="both">
                            <option value="both">Both (Neon + 3D)</option>
                            <option value="neon_only">Neon Only</option>
                            <option value="3d_only">3D Only</option>
                        </select>
                        <s-button type="submit" {...(isSubmitting ? { loading: true } : {})}>Add Symbol</s-button>
                    </s-stack>
                </fetcher.Form>
            </s-section>

            <s-section heading={`Existing Symbols (${symbols.length})`}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                        <tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
                            <th style={{ padding: "8px" }}>Icon</th>
                            <th style={{ padding: "8px" }}>Label</th>
                            <th style={{ padding: "8px" }}>Sort Order</th>
                            <th style={{ padding: "8px" }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {symbols.map((s) => (
                            <tr key={s.id} style={{ borderBottom: "1px solid #eee" }}>
                                {editingId === s.id ? (
                                    <td colSpan={4} style={{ padding: "8px" }}>
                                        <fetcher.Form method="post" encType="multipart/form-data">
                                            <input type="hidden" name="intent" value="update" />
                                            <input type="hidden" name="id" value={s.id} />
                                            <s-stack direction="inline" gap="base">
                                                <input type="text" name="label" defaultValue={s.label} required />
                                                <input type="file" name="icon" accept=".svg,image/svg+xml" />
                                                <span style={{ fontSize: "11px", color: "#888" }}>(leave empty to keep current icon)</span>
                                                <input type="number" name="sortOrder" defaultValue={s.sortOrder} />
                                                <select name="visibility" defaultValue={s.visibility}>
                                                    <option value="both">Both (Neon + 3D)</option>
                                                    <option value="neon_only">Neon Only</option>
                                                    <option value="3d_only">3D Only</option>
                                                </select>
                                                <s-button type="submit" {...(isSubmitting ? { loading: true } : {})}>Save</s-button>
                                                <s-button variant="tertiary" onClick={() => setEditingId(null)}>Cancel</s-button>
                                            </s-stack>
                                        </fetcher.Form>
                                    </td>
                                ) : (
                                    <>
                                        <td style={{ padding: "8px" }}>
                                            {s.iconUrl ? <img src={s.iconUrl} alt={s.label} width={28} height={28} /> : "—"}
                                        </td>
                                        <td style={{ padding: "8px" }}>{s.label}</td>
                                        <td style={{ padding: "8px" }}>{s.sortOrder}</td>
                                        <td style={{ padding: "8px" }}>
                                            <s-stack direction="inline" gap="tight">
                                                <s-button variant="tertiary" onClick={() => setEditingId(s.id)}>Edit</s-button>
                                                <fetcher.Form method="post">
                                                    <input type="hidden" name="intent" value="delete" />
                                                    <input type="hidden" name="id" value={s.id} />
                                                    <s-button variant="tertiary" tone="critical" type="submit"
                                                        onClick={(e) => { if (!confirm(`Delete "${s.label}"?`)) e.preventDefault(); }}>
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