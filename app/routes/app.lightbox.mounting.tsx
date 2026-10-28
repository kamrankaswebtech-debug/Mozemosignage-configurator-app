import { useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

// 3D LED Lightbox mounting cards (Wall Mount / Wall Hanging): example image + short description.
// Stored as lightbox_option entries with category "mounting" and type_key wall_mount / wall_hanging
// (no new metaobject definition). The mounting rules (widths, pole) stay built into the configurator.
const MOUNTS = [
    { key: "wall_mount", label: "Wall Mount", hint: "Attached directly to the wall — front and sides visible, front-facing illumination." },
    { key: "wall_hanging", label: "Wall Hanging", hint: "Projects from the wall on a pole / bracket — front, rear and sides visible. Front-facing or double-sided." },
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
    return fileId;
}

const hasFile = (v: FormDataEntryValue | null): v is File => !!v && typeof v === "object" && "size" in v && (v as File).size > 0;

type Entry = { id: string; key: string; description: string; imageUrl: string; category: string };

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { admin } = await authenticate.admin(request);
    const response = await admin.graphql(
        `#graphql
    query LightboxMounts { metaobjects(type: "$app:lightbox_option", first: 250) { edges { node { id fields { key value reference { ... on MediaImage { image { url } } } } } } } }`
    );
    const data = await response.json();
    const entries: Entry[] = (data.data?.metaobjects?.edges || [])
        .map((edge: any) => {
            const f: Record<string, string> = {};
            let imageUrl = "";
            edge.node.fields.forEach((x: any) => {
                f[x.key] = x.value || "";
                if (x.key === "image" && x.reference?.image?.url) imageUrl = x.reference.image.url;
            });
            return { id: edge.node.id, key: f.type_key || "", description: f.description || "", imageUrl, category: String(f.category || "").trim().toLowerCase() };
        })
        .filter((e: Entry) => e.category === "mounting");
    const items = MOUNTS.map((m) => ({ ...m, entry: entries.find((e) => e.key === m.key) || null }));
    return { items };
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const { admin } = await authenticate.admin(request);
    const formData = await request.formData();
    const key = String(formData.get("key") || "");
    const mount = MOUNTS.find((m) => m.key === key);
    if (!mount) return { error: "Unknown mounting" };
    const id = String(formData.get("id") || "");
    const fields: { key: string; value: string }[] = [{ key: "description", value: String(formData.get("description") || "") }];
    const file = formData.get("imageFile");
    try {
        if (hasFile(file)) fields.push({ key: "image", value: await uploadImageFile(admin, file) });
        else if (formData.get("removeImage") === "1") fields.push({ key: "image", value: "" });
    } catch (err: any) {
        return { error: err?.message || "Image upload failed" };
    }
    if (id) {
        const res = await admin.graphql(
            `#graphql
      mutation UpdateMount($id: ID!, $metaobject: MetaobjectUpdateInput!) { metaobjectUpdate(id: $id, metaobject: $metaobject) { metaobject { id } userErrors { message } } }`,
            { variables: { id, metaobject: { fields } } }
        );
        const data = await res.json();
        const errs = data.data?.metaobjectUpdate?.userErrors;
        if (errs?.length) return { error: errs[0].message };
    } else {
        fields.push(
            { key: "category", value: "mounting" },
            { key: "type_key", value: key },
            { key: "label", value: mount.label },
            { key: "sort_order", value: String(MOUNTS.indexOf(mount) + 1) }
        );
        const res = await admin.graphql(
            `#graphql
      mutation CreateMount($metaobject: MetaobjectCreateInput!) { metaobjectCreate(metaobject: $metaobject) { metaobject { id } userErrors { message } } }`,
            { variables: { metaobject: { type: "$app:lightbox_option", fields } } }
        );
        const data = await res.json();
        const errs = data.data?.metaobjectCreate?.userErrors;
        if (errs?.length) return { error: errs[0].message };
    }
    return { success: true };
};

export default function LightboxMountingPage() {
    const { items } = useLoaderData<typeof loader>();
    const fetcher = useFetcher<typeof action>();
    const shopify = useAppBridge();
    const isSubmitting = fetcher.state !== "idle";

    useEffect(() => {
        if (fetcher.data && "success" in fetcher.data && fetcher.data.success) shopify.toast.show("Saved");
        if (fetcher.data && "error" in fetcher.data && fetcher.data.error) shopify.toast.show(fetcher.data.error, { isError: true });
    }, [fetcher.data, shopify]);

    return (
        <s-page heading="Lightbox Mounting Images">
            <s-section heading="Wall Mount / Wall Hanging cards">
                <s-link href="/app/lightbox">← Back to 3D LED Lightbox</s-link>
                <s-paragraph>
                    Upload an example image (and optional short text) for each mounting card on the 3D LED Lightbox configurator. The mounting
                    rules (Wall Mount 40–500 cm, Wall Hanging 40–100 cm with pole / bracket) stay the same.
                </s-paragraph>
                {items.map((m) => (
                    <fetcher.Form key={m.key} method="post" encType="multipart/form-data" style={{ marginBottom: 18 }}>
                        <input type="hidden" name="key" value={m.key} />
                        <input type="hidden" name="id" value={m.entry?.id || ""} />
                        <s-stack direction="inline" gap="base">
                            <strong style={{ minWidth: 110 }}>{m.label}</strong>
                            {m.entry?.imageUrl ? (
                                <img src={m.entry.imageUrl} alt="" style={{ width: 96, height: 60, objectFit: "cover", background: "#111", borderRadius: 4 }} />
                            ) : (
                                <span>No image yet</span>
                            )}
                            <input type="text" name="description" defaultValue={m.entry?.description || m.hint} style={{ minWidth: 320 }} />
                            <input type="file" name="imageFile" accept="image/*" />
                            {m.entry?.imageUrl ? (
                                <label><input type="checkbox" name="removeImage" value="1" /> Remove image</label>
                            ) : null}
                            <s-button type="submit" {...(isSubmitting ? { loading: true } : {})}>Save</s-button>
                        </s-stack>
                    </fetcher.Form>
                ))}
            </s-section>
        </s-page>
    );
}
