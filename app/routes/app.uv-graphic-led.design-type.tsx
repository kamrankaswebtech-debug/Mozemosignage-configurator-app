import { useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

// The two Design Type cards of the Graphic configurator. Stored as uv_finish entries with a
// design_key (the app is at the metaobject definition limit, so no new definition is added).
const DESIGN_TYPES = [
    { key: "graphic", label: "Graphic Only" },
    { key: "text", label: "Text + Graphic" },
];

const LIST_QUERY = `#graphql
    query ListDesignTypeImages {
      metaobjects(type: "$app:uv_finish", first: 100) {
        edges {
          node {
            id
            fields {
              key
              value
              reference {
                ... on MediaImage { image { url } }
              }
            }
          }
        }
      }
    }`;

type DesignRow = { id: string; designKey: string; hasImage: boolean; imageUrl: string | null };

function readRows(data: any): DesignRow[] {
    return data.data.metaobjects.edges
        .map((edge: any) => {
            const key = edge.node.fields.find((x: any) => x.key === "design_key")?.value || "";
            const image = edge.node.fields.find((x: any) => x.key === "preview_image");
            return { id: edge.node.id, designKey: key, hasImage: !!image?.value, imageUrl: image?.reference?.image?.url || null };
        })
        .filter((row: DesignRow) => row.designKey);
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { admin } = await authenticate.admin(request);
    const response = await admin.graphql(LIST_QUERY);
    const rows = readRows(await response.json());
    return {
        cards: DESIGN_TYPES.map((d) => {
            const row = rows.find((r) => r.designKey === d.key);
            return { ...d, hasImage: !!row?.hasImage, imageUrl: row?.imageUrl || null };
        }),
    };
};

// Same stagedUploadsCreate -> direct upload -> fileCreate flow as the Backboard Styles page.
// Returns the file's GID, which is what a file_reference metaobject field value must be set to.
async function uploadPreviewImage(admin: any, file: File): Promise<string> {
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
                        mimeType: file.type || "image/png",
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

    const target = stagedData.data?.stagedUploadsCreate?.stagedTargets?.[0];
    if (!target) throw new Error("Could not get an upload target");

    const uploadForm = new FormData();
    target.parameters.forEach((param: { name: string; value: string }) => {
        uploadForm.append(param.name, param.value);
    });
    uploadForm.append("file", file);

    const uploadResponse = await fetch(target.url, { method: "POST", body: uploadForm });
    if (!uploadResponse.ok) throw new Error("File upload to storage failed");

    const fileCreateResponse = await admin.graphql(
        `#graphql
    mutation FileCreate($files: [FileCreateInput!]!) {
      fileCreate(files: $files) {
        files { id fileStatus ... on MediaImage { image { url } } }
        userErrors { field message }
      }
    }`,
        {
            variables: {
                files: [
                    {
                        originalSource: target.resourceUrl,
                        contentType: "IMAGE",
                    },
                ],
            },
        }
    );
    const fileCreateData = await fileCreateResponse.json();
    const fileCreateErrors = fileCreateData.data?.fileCreate?.userErrors;
    if (fileCreateErrors?.length) throw new Error(fileCreateErrors[0].message);

    const createdFile = fileCreateData.data?.fileCreate?.files?.[0];
    if (!createdFile?.id) throw new Error("File registration failed");

    return createdFile.id;
}

export const action = async ({ request }: ActionFunctionArgs) => {
    const { admin } = await authenticate.admin(request);
    const formData = await request.formData();
    const design = DESIGN_TYPES.find((d) => d.key === String(formData.get("designKey")));
    if (!design) return { error: "Unknown design type" };

    const imageFile = formData.get("previewImage");
    const removeImage = formData.get("removeImage") === "on";
    const hasNewImage = imageFile instanceof File && imageFile.size > 0;
    if (!hasNewImage && !removeImage) return { error: "Please choose an image first" };

    let imageValue = "";
    if (hasNewImage) {
        try {
            imageValue = await uploadPreviewImage(admin, imageFile as File);
        } catch (err: any) {
            console.error("Design Type Images: image upload failed", err);
            return { error: err?.message || "Image upload failed" };
        }
    }

    const listResponse = await admin.graphql(LIST_QUERY);
    const existing = readRows(await listResponse.json()).find((r) => r.designKey === design.key);
    const fields = [{ key: "preview_image", value: imageValue }];

    if (existing) {
        const response = await admin.graphql(
            `#graphql
      mutation UpdateDesignTypeImage($id: ID!, $metaobject: MetaobjectUpdateInput!) {
        metaobjectUpdate(id: $id, metaobject: $metaobject) {
          metaobject { id }
          userErrors { field message }
        }
      }`,
            { variables: { id: existing.id, metaobject: { fields } } }
        );
        const data = await response.json();
        const errors = data.data?.metaobjectUpdate?.userErrors;
        if (errors?.length) return { error: errors[0].message };
        return { success: true };
    }

    if (!imageValue) return { success: true };
    const response = await admin.graphql(
        `#graphql
      mutation CreateDesignTypeImage($metaobject: MetaobjectCreateInput!) {
        metaobjectCreate(metaobject: $metaobject) {
          metaobject { id }
          userErrors { field message }
        }
      }`,
        {
            variables: {
                metaobject: {
                    type: "$app:uv_finish",
                    fields: [
                        { key: "label", value: design.label },
                        { key: "design_key", value: design.key },
                        ...fields,
                    ],
                },
            },
        }
    );
    const data = await response.json();
    const errors = data.data?.metaobjectCreate?.userErrors;
    if (errors?.length) return { error: errors[0].message };
    return { success: true };
};

function DesignCard({ card }: { card: { key: string; label: string; hasImage: boolean; imageUrl: string | null } }) {
    const fetcher = useFetcher<typeof action>();
    const shopify = useAppBridge();
    const isSubmitting = fetcher.state !== "idle";

    useEffect(() => {
        if (fetcher.data && "success" in fetcher.data && fetcher.data.success) {
            shopify.toast.show("Saved successfully");
        }
        if (fetcher.data && "error" in fetcher.data && fetcher.data.error) {
            shopify.toast.show(fetcher.data.error, { isError: true });
        }
    }, [fetcher.data, shopify]);

    return (
        <s-section heading={card.label}>
            <fetcher.Form method="post" encType="multipart/form-data">
                <input type="hidden" name="designKey" value={card.key} />
                <s-stack direction="block" gap="base">
                    {card.imageUrl ? (
                        <img src={card.imageUrl} alt={card.label} width="240" height="130" style={{ objectFit: "contain", background: "#111", borderRadius: "4px" }} />
                    ) : (
                        <s-paragraph>{card.hasImage ? "Image uploaded — still processing, refresh in a moment." : "No image — the storefront shows the simple icon."}</s-paragraph>
                    )}
                    {card.hasImage && (
                        <label>
                            <input type="checkbox" name="removeImage" /> Remove current image
                        </label>
                    )}
                    <label>
                        {card.hasImage ? "Replace Image" : "Add Image"}
                        <input type="file" name="previewImage" accept="image/*" />
                    </label>
                    <s-button type="submit" {...(isSubmitting ? { loading: true } : {})}>Save</s-button>
                </s-stack>
            </fetcher.Form>
        </s-section>
    );
}

export default function DesignTypeImagesPage() {
    const { cards } = useLoaderData<typeof loader>();
    return (
        <s-page heading="Design Type Images">
            <s-section>
                <s-link href="/app/uv-graphic-led">← Back to Graphic LED</s-link>
                <s-paragraph>
                    These images appear on the Graphic Only and Text + Graphic cards of the Graphic configurator.
                </s-paragraph>
            </s-section>
            {cards.map((card) => <DesignCard key={card.key} card={card} />)}
        </s-page>
    );
}
