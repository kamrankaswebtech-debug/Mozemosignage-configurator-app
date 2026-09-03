import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export async function action({ request }: ActionFunctionArgs) {
    const { admin } = await authenticate.public.appProxy(request);

    if (!admin) {
        return Response.json({ error: "Unauthorized or app not installed on this shop" }, { status: 401 });
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