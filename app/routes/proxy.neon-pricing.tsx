import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export async function action({ request }: ActionFunctionArgs) {
    const { admin } = await authenticate.public.appProxy(request);

    if (!admin) {
        return Response.json({ error: "Unauthorized or app not installed on this shop" }, { status: 401 });
    }

    // Branch by content-type: a design-file upload arrives as multipart/form-data,
    // while every existing pricing call (Neon, 3D, Lightbox, etc.) sends plain JSON.
    // This keeps the original pricing logic below 100% untouched — nothing here changes
    // how JSON requests are parsed or handled.
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
        return handleFileUpload(request, admin);
    }

    const body = await request.json();
    const { productId, price } = body;

    if (!productId || !price) {
        return Response.json({ error: "Missing productId or price" }, { status: 400 });
    }

    const priceString = parseFloat(price).toFixed(2);
    const optionValue = `Config-${priceString}`;
    const gid = `gid://shopify/Product/${productId}`;

    // Step 1: Look at the product's current options AND existing variants in one call
    const stateResponse = await admin.graphql(
        `#graphql
    query GetProductState($productId: ID!) {
      product(id: $productId) {
        options { name }
        variants(first: 100) {
          edges {
            node {
              id
              price
              selectedOptions { name value }
            }
          }
        }
      }
    }`,
        { variables: { productId: gid } }
    );
    const stateData = await stateResponse.json();
    const existingOptions = stateData.data?.product?.options || [];
    const existingVariants = stateData.data?.product?.variants?.edges || [];
    const hasConfigOption = existingOptions.some((opt: any) => opt.name === "Configuration");

    // Step 2: If the "Configuration" option doesn't exist yet, create it —
    // Shopify auto-creates a matching variant for us, but with the WRONG price (base product price).
    // We immediately fix its price + make it always purchasable (no inventory blocking).
    if (!hasConfigOption) {
        const createOptionResponse = await admin.graphql(
            `#graphql
      mutation CreateConfigOption($productId: ID!, $options: [OptionCreateInput!]!) {
        productOptionsCreate(productId: $productId, options: $options) {
          product {
            variants(first: 10) {
              edges { node { id selectedOptions { name value } } }
            }
          }
          userErrors { field message }
        }
      }`,
            {
                variables: {
                    productId: gid,
                    options: [{ name: "Configuration", values: [{ name: optionValue }] }],
                },
            }
        );
        const createOptionData = await createOptionResponse.json();
        const optionErrors = createOptionData.data?.productOptionsCreate?.userErrors;
        if (optionErrors?.length) {
            console.error("Neon Pricing Proxy: option creation error", optionErrors);
            return Response.json({ error: optionErrors[0].message }, { status: 422 });
        }

        const newVariants = createOptionData.data?.productOptionsCreate?.product?.variants?.edges || [];
        const autoCreatedVariant = newVariants.find((edge: any) =>
            edge.node.selectedOptions.some((opt: any) => opt.name === "Configuration" && opt.value === optionValue)
        );

        if (!autoCreatedVariant) {
            return Response.json({ error: "Could not locate the newly created variant" }, { status: 500 });
        }

        const fixPriceResponse = await admin.graphql(
            `#graphql
      mutation FixVariantPrice($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) {
          productVariants { id price }
          userErrors { field message }
        }
      }`,
            {
                variables: {
                    productId: gid,
                    variants: [
                        {
                            id: autoCreatedVariant.node.id,
                            price: priceString,
                            inventoryPolicy: "CONTINUE",
                        },
                    ],
                },
            }
        );
        const fixPriceData = await fixPriceResponse.json();
        const fixPriceErrors = fixPriceData.data?.productVariantsBulkUpdate?.userErrors;
        if (fixPriceErrors?.length) {
            console.error("Neon Pricing Proxy: price fix error", fixPriceErrors);
            return Response.json({ error: fixPriceErrors[0].message }, { status: 422 });
        }

        const fixedVariant = fixPriceData.data?.productVariantsBulkUpdate?.productVariants?.[0];
        const numericVariantId = fixedVariant.id.split("/").pop();
        return Response.json({ variantId: numericVariantId, price: fixedVariant.price, reused: false });
    }

    // Step 3: Option already exists — check if a variant at this exact price already exists.
    const match = existingVariants.find((edge: any) =>
        edge.node.selectedOptions.some(
            (opt: any) => opt.name === "Configuration" && opt.value === optionValue
        )
    );

    if (match) {
        const numericVariantId = match.node.id.split("/").pop();
        return Response.json({ variantId: numericVariantId, price: match.node.price, reused: true });
    }

    // Step 4: No matching variant found — create a new one for this exact price.
    const response = await admin.graphql(
        `#graphql
    mutation createConfiguredVariant($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkCreate(productId: $productId, variants: $variants) {
        productVariants { id price }
        userErrors { field message }
      }
    }`,
        {
            variables: {
                productId: gid,
                variants: [
                    {
                        price: priceString,
                        inventoryPolicy: "CONTINUE",
                        optionValues: [
                            {
                                optionName: "Configuration",
                                name: optionValue,
                            },
                        ],
                    },
                ],
            },
        }
    );

    const data = await response.json();
    const result = data.data?.productVariantsBulkCreate;

    if (result?.userErrors?.length > 0) {
        console.error("Neon Pricing Proxy: userErrors", result.userErrors);
        return Response.json({ error: result.userErrors[0].message }, { status: 422 });
    }

    const newVariant = result?.productVariants?.[0];
    if (!newVariant) {
        return Response.json({ error: "Variant creation failed, no variant returned" }, { status: 500 });
    }

    const numericVariantId = newVariant.id.split("/").pop();
    return Response.json({ variantId: numericVariantId, price: newVariant.price, reused: false });
}

// Handles a customer-uploaded design file (Bonnet / Lightbox configurators) via Shopify's
// standard stagedUploadsCreate -> direct upload -> fileCreate flow — the same proven pattern
// already used for Neon Font uploads in the Admin. Returns a public fileUrl the storefront
// stores in the cart line item property, and the manufacturing team can open from the order.
async function handleFileUpload(request: Request, admin: any) {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!file || typeof file === "string") {
        return Response.json({ error: "No file provided" }, { status: 400 });
    }

    try {
        const fileSizeBytes = file.size;
        const mimeType = file.type || "application/octet-stream";
        const fileName = file.name || "design-upload";

        // Step 1: Ask Shopify for a temporary, authenticated upload target
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
                            filename: fileName,
                            mimeType,
                            fileSize: String(fileSizeBytes),
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
            console.error("Neon Pricing Proxy: staged upload error", stagedErrors);
            return Response.json({ error: stagedErrors[0].message }, { status: 422 });
        }

        const target = stagedData.data?.stagedUploadsCreate?.stagedTargets?.[0];
        if (!target) {
            return Response.json({ error: "Could not get an upload target" }, { status: 500 });
        }

        // Step 2: Upload the actual file bytes directly to Shopify's storage
        const uploadFormData = new FormData();
        target.parameters.forEach((param: { name: string; value: string }) => {
            uploadFormData.append(param.name, param.value);
        });
        uploadFormData.append("file", file, fileName);

        const uploadResponse = await fetch(target.url, {
            method: "POST",
            body: uploadFormData,
        });

        if (!uploadResponse.ok) {
            console.error("Neon Pricing Proxy: direct upload to storage failed", uploadResponse.status);
            return Response.json({ error: "File upload to storage failed" }, { status: 502 });
        }

        // Step 3: Register the uploaded file as a real Shopify File so it gets a permanent URL
        const fileCreateResponse = await admin.graphql(
            `#graphql
      mutation FileCreate($files: [FileCreateInput!]!) {
        fileCreate(files: $files) {
          files {
            id
            fileStatus
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
                            contentType: mimeType.startsWith("image/") ? "IMAGE" : "FILE",
                        },
                    ],
                },
            }
        );
        const fileCreateData = await fileCreateResponse.json();
        const fileCreateErrors = fileCreateData.data?.fileCreate?.userErrors;
        if (fileCreateErrors?.length) {
            console.error("Neon Pricing Proxy: fileCreate error", fileCreateErrors);
            return Response.json({ error: fileCreateErrors[0].message }, { status: 422 });
        }

        const createdFile = fileCreateData.data?.fileCreate?.files?.[0];
        if (!createdFile) {
            return Response.json({ error: "File registration failed" }, { status: 500 });
        }

        // A freshly-created file can briefly report fileStatus "UPLOADED" with no url yet
        // while Shopify finishes processing it. Give the storefront the resourceUrl as a
        // fallback so the customer never sees a broken/empty response.
        const fileUrl = createdFile.image?.url || createdFile.url || target.resourceUrl;

        return Response.json({ fileUrl });
    } catch (err) {
        console.error("Neon Pricing Proxy: unexpected upload error", err);
        return Response.json({ error: "Unexpected error during upload" }, { status: 500 });
    }
}