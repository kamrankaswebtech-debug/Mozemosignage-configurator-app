import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export async function action({ request }: ActionFunctionArgs) {
    const { admin } = await authenticate.public.appProxy(request);

    if (!admin) {
        return Response.json({ error: "Unauthorized or app not installed on this shop" }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
        return Response.json({ error: "No file provided" }, { status: 400 });
    }

    // Step 1: Request a staged upload target from Shopify
    const stagedResponse = await admin.graphql(
        `#graphql
    mutation StagedUploadsCreate($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets {
          url
          resourceUrl
          parameters { name value }
        }
        userErrors { field message }
      }
    }`,
        {
            variables: {
                input: [
                    {
                        filename: file.name,
                        mimeType: file.type || "application/octet-stream",
                        httpMethod: "POST",
                        resource: "FILE",
                    },
                ],
            },
        }
    );

    const stagedData = await stagedResponse.json();
    const stagedErrors = stagedData.data?.stagedUploadsCreate?.userErrors;
    if (stagedErrors?.length) {
        return Response.json({ error: stagedErrors[0].message }, { status: 422 });
    }

    const target = stagedData.data?.stagedUploadsCreate?.stagedTargets?.[0];
    if (!target) {
        return Response.json({ error: "Failed to get upload target" }, { status: 500 });
    }

    // Step 2: Upload the actual file bytes to the staged URL
    const uploadForm = new FormData();
    target.parameters.forEach((param: { name: string; value: string }) => {
        uploadForm.append(param.name, param.value);
    });
    uploadForm.append("file", file);

    const uploadResponse = await fetch(target.url, {
        method: "POST",
        body: uploadForm,
    });

    if (!uploadResponse.ok) {
        return Response.json({ error: "File upload to storage failed" }, { status: 500 });
    }

    // Step 3: Register the uploaded file in Shopify Files
    const fileCreateResponse = await admin.graphql(
        `#graphql
    mutation FileCreate($files: [FileCreateInput!]!) {
      fileCreate(files: $files) {
        files {
          id
          fileStatus
          alt
          ... on GenericFile { url }
          ... on MediaImage {
            image { url }
          }
        }
        userErrors { field message }
      }
    }`,
        {
            variables: {
                files: [
                    {
                        originalSource: target.resourceUrl,
                        contentType: file.type.startsWith("image/") ? "IMAGE" : "FILE",
                        alt: `Customer uploaded design: ${file.name}`,
                    },
                ],
            },
        }
    );

    const fileCreateData = await fileCreateResponse.json();
    const fileErrors = fileCreateData.data?.fileCreate?.userErrors;
    if (fileErrors?.length) {
        return Response.json({ error: fileErrors[0].message }, { status: 422 });
    }

    const createdFile = fileCreateData.data?.fileCreate?.files?.[0];

    // Image files may take a moment to process — return what we have immediately;
    // the URL may be null right away for brand-new images (fileStatus: "UPLOADED" not yet "READY")
    const fileUrl = createdFile?.image?.url || createdFile?.url || target.resourceUrl;

    return Response.json({ fileUrl, fileId: createdFile?.id, status: createdFile?.fileStatus });
}