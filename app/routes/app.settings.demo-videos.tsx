import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

type VideoEntry = {
    id: string;
    title: string;
    sourceType: string;
    videoUrl: string;
    videoFileUrl: string | null;
    sortOrder: string;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { admin } = await authenticate.admin(request);
    const response = await admin.graphql(
        `#graphql
    query ListDemoVideos {
      metaobjects(type: "$app:signage_addon", first: 100) {
        edges {
          node {
            id
            fields {
              key
              value
              reference {
                ... on Video { sources { url } }
              }
            }
          }
        }
      }
    }`
    );
    const data = await response.json();
    const videos: VideoEntry[] = data.data.metaobjects.edges
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
                title: f.label || "",
                sourceType: f.video_source_type || "youtube",
                videoUrl: f.video_url || "",
                videoFileUrl,
                sortOrder: f.sort_order || "0",
            };
        })
        .filter((v: any) => v.category === "demo_video");
    videos.sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder));
    return { videos };
};

// Same stagedUploadsCreate -> direct upload -> fileCreate pattern already used
// elsewhere in this app — resource "VIDEO" instead of "FILE"/"IMAGE".
async function uploadDemoVideoFile(admin: any, file: File): Promise<string> {
    const stagedResponse = await admin.graphql(
        `#graphql
    mutation StagedUploadsCreate($input: [StagedUploadInput!]!) {
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
                        mimeType: file.type || "video/mp4",
                        httpMethod: "POST",
                        resource: "VIDEO",
                    },
                ],
            },
        }
    );
    const stagedData = await stagedResponse.json();
    const stagedErrors = stagedData.data?.stagedUploadsCreate?.userErrors;
    if (stagedErrors?.length) throw new Error(stagedErrors[0].message);

    const target = stagedData.data?.stagedUploadsCreate?.stagedTargets?.[0];
    if (!target) throw new Error("Could not get an upload target");

    const uploadForm = new FormData();
    target.parameters.forEach((param: { name: string; value: string }) => {
        uploadForm.append(param.name, param.value);
    });
    uploadForm.append("file", file);

    const uploadResponse = await fetch(target.url, { method: "POST", body: uploadForm });
    if (!uploadResponse.ok) throw new Error("Video upload to storage failed");

    const fileCreateResponse = await admin.graphql(
        `#graphql
    mutation FileCreate($files: [FileCreateInput!]!) {
      fileCreate(files: $files) {
        files { id fileStatus ... on Video { sources { url } } }
        userErrors { field message }
      }
    }`,
        {
            variables: {
                files: [
                    { originalSource: target.resourceUrl, contentType: "VIDEO" },
                ],
            },
        }
    );
    const fileCreateData = await fileCreateResponse.json();
    const fileCreateErrors = fileCreateData.data?.fileCreate?.userErrors;
    if (fileCreateErrors?.length) throw new Error(fileCreateErrors[0].message);

    const createdFile = fileCreateData.data?.fileCreate?.files?.[0];
    if (!createdFile?.id) throw new Error("Video registration failed");

    return createdFile.id;
}

export const action = async ({ request }: ActionFunctionArgs) => {
    const { admin } = await authenticate.admin(request);
    const formData = await request.formData();
    const intent = formData.get("intent");
    const sourceType = String(formData.get("sourceType") || "youtube");

    const fields = [
        { key: "category", value: "demo_video" },
        { key: "label", value: String(formData.get("title") || "Demo video") },
        { key: "video_source_type", value: sourceType },
        { key: "video_url", value: sourceType === "upload" ? "" : String(formData.get("videoUrl") || "") },
        { key: "sort_order", value: String(formData.get("sortOrder") || "0") },
    ];

    const videoFile = formData.get("videoFile");
    const removeVideoFile = formData.get("removeVideoFile") === "on";

    if (sourceType === "upload" && videoFile instanceof File && videoFile.size > 0) {
        try {
            const fileGid = await uploadDemoVideoFile(admin, videoFile);
            fields.push({ key: "video_file", value: fileGid });
        } catch (err: any) {
            console.error("Demo Videos: upload failed", err);
            return { error: err?.message || "Video upload failed" };
        }
    } else if (sourceType !== "upload" || removeVideoFile) {
        fields.push({ key: "video_file", value: "" });
    }

    if (intent === "create") {
        const response = await admin.graphql(
            `#graphql
      mutation CreateDemoVideo($metaobject: MetaobjectCreateInput!) {
        metaobjectCreate(metaobject: $metaobject) { metaobject { id } userErrors { field message } }
      }`,
            { variables: { metaobject: { type: "$app:signage_addon", fields } } }
        );
        const data = await response.json();
        const errors = data.data?.metaobjectCreate?.userErrors;
        if (errors?.length) return { error: errors[0].message };
        return { success: true };
    }

    if (intent === "update") {
        const id = String(formData.get("id"));
        const response = await admin.graphql(
            `#graphql
      mutation UpdateDemoVideo($id: ID!, $metaobject: MetaobjectUpdateInput!) {
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
      mutation DeleteDemoVideo($id: ID!) { metaobjectDelete(id: $id) { deletedId userErrors { field message } } }`,
            { variables: { id } }
        );
        const data = await response.json();
        const errors = data.data?.metaobjectDelete?.userErrors;
        if (errors?.length) return { error: errors[0].message };
        return { success: true };
    }

    return { error: "Unknown action" };
};

export default function DemoVideosPage() {
    const { videos } = useLoaderData<typeof loader>();
    const fetcher = useFetcher<typeof action>();
    const shopify = useAppBridge();
    const [editingId, setEditingId] = useState<string | null>(null);
    const [newSourceType, setNewSourceType] = useState("youtube");
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
        <s-page heading="Manage Demo Videos">
            <s-section heading="Add New Demo Video">
                <s-link href="/app/settings">← Back to Settings</s-link>
                <s-paragraph>
                    These videos power the "Demo" button on your app's dashboard, showing merchants how to
                    add a configurator block to their theme. Add a YouTube link, a Vimeo link, or upload a
                    video file directly. Add more than one so people can switch between videos in the popup.
                </s-paragraph>
                <fetcher.Form method="post" encType="multipart/form-data">
                    <input type="hidden" name="intent" value="create" />
                    <s-stack direction="block" gap="base">
                        <input type="text" name="title" placeholder="Video title (e.g. Add the Neon block)" required />
                        <s-stack direction="inline" gap="base">
                            <label>
                                <input type="radio" name="sourceType" value="youtube" checked={newSourceType === "youtube"} onChange={() => setNewSourceType("youtube")} /> YouTube
                            </label>
                            <label>
                                <input type="radio" name="sourceType" value="vimeo" checked={newSourceType === "vimeo"} onChange={() => setNewSourceType("vimeo")} /> Vimeo
                            </label>
                            <label>
                                <input type="radio" name="sourceType" value="upload" checked={newSourceType === "upload"} onChange={() => setNewSourceType("upload")} /> Upload File
                            </label>
                        </s-stack>
                        {newSourceType !== "upload" ? (
                            <input type="text" name="videoUrl" placeholder="https://www.youtube.com/watch?v=... or https://vimeo.com/..." />
                        ) : (
                            <input type="file" name="videoFile" accept="video/*" />
                        )}
                        <input type="number" name="sortOrder" placeholder="Sort Order" defaultValue={videos.length + 1} />
                        <s-button type="submit" {...(isSubmitting ? { loading: true } : {})}>Add Video</s-button>
                    </s-stack>
                </fetcher.Form>
            </s-section>

            <s-section heading={`Existing Videos (${videos.length})`}>
                {videos.length === 0 && <s-paragraph>No demo videos yet — the Demo button will stay hidden until you add one.</s-paragraph>}
                <s-stack direction="block" gap="base">
                    {videos.map((v) => (
                        <s-box key={v.id} padding="base" borderWidth="base" borderRadius="base" background="subdued">
                            {editingId === v.id ? (
                                <fetcher.Form method="post" encType="multipart/form-data">
                                    <input type="hidden" name="intent" value="update" />
                                    <input type="hidden" name="id" value={v.id} />
                                    <s-stack direction="block" gap="base">
                                        <input type="text" name="title" defaultValue={v.title} required />
                                        <s-stack direction="inline" gap="base">
                                            <label><input type="radio" name="sourceType" value="youtube" defaultChecked={v.sourceType === "youtube"} /> YouTube</label>
                                            <label><input type="radio" name="sourceType" value="vimeo" defaultChecked={v.sourceType === "vimeo"} /> Vimeo</label>
                                            <label><input type="radio" name="sourceType" value="upload" defaultChecked={v.sourceType === "upload"} /> Upload File</label>
                                        </s-stack>
                                        <input type="text" name="videoUrl" placeholder="https://www.youtube.com/watch?v=... or https://vimeo.com/..." defaultValue={v.videoUrl} />
                                        {v.videoFileUrl && (
                                            <label><input type="checkbox" name="removeVideoFile" /> Remove current uploaded file</label>
                                        )}
                                        <label>
                                            Replace/upload file (only used if "Upload File" selected)
                                            <input type="file" name="videoFile" accept="video/*" />
                                        </label>
                                        <input type="number" name="sortOrder" defaultValue={v.sortOrder} />
                                        <s-stack direction="inline" gap="tight">
                                            <s-button type="submit" {...(isSubmitting ? { loading: true } : {})}>Save</s-button>
                                            <s-button variant="tertiary" onClick={() => setEditingId(null)}>Cancel</s-button>
                                        </s-stack>
                                    </s-stack>
                                </fetcher.Form>
                            ) : (
                                <s-stack direction="inline" gap="base" alignItems="center">
                                    <s-stack direction="block" gap="tight" style={{ flex: 1 }}>
                                        <s-text>{v.title}</s-text>
                                        <s-paragraph>
                                            {v.sourceType === "upload" ? (v.videoFileUrl ? "Uploaded file" : "No file uploaded") : `${v.sourceType} — ${v.videoUrl || "no URL set"}`}
                                        </s-paragraph>
                                    </s-stack>
                                    <s-stack direction="inline" gap="tight">
                                        <s-button variant="tertiary" onClick={() => setEditingId(v.id)}>Edit</s-button>
                                        <fetcher.Form method="post">
                                            <input type="hidden" name="intent" value="delete" />
                                            <input type="hidden" name="id" value={v.id} />
                                            <s-button variant="tertiary" tone="critical" type="submit"
                                                onClick={(e) => { if (!confirm(`Delete video "${v.title}"?`)) e.preventDefault(); }}>
                                                Delete
                                            </s-button>
                                        </fetcher.Form>
                                    </s-stack>
                                </s-stack>
                            )}
                        </s-box>
                    ))}
                </s-stack>
            </s-section>
        </s-page>
    );
}