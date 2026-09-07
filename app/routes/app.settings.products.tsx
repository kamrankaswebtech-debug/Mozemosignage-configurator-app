import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useSearchParams } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

type ProductEntry = {
    id: string;
    title: string;
    imageUrl: string;
    mode: string;
    templateSuffix: string;
};

type TemplateOption = { label: string; value: string };

async function getMainThemeId(admin: any): Promise<string | null> {
    const response = await admin.graphql(
        `#graphql
    query MainTheme {
      themes(first: 1, roles: [MAIN]) {
        nodes { id }
      }
    }`
    );
    const data = await response.json();
    return data.data?.themes?.nodes?.[0]?.id || null;
}

async function getProductTemplates(admin: any): Promise<TemplateOption[]> {
    const themeId = await getMainThemeId(admin);
    if (!themeId) return [];

    const suffixes: string[] = [];
    let after: string | null = null;
    let hasNextPage = true;

    while (hasNextPage) {
        const response: any = await admin.graphql(
            `#graphql
      query ThemeFiles($id: ID!, $after: String) {
        theme(id: $id) {
          files(first: 250, after: $after) {
            nodes { filename }
            pageInfo { hasNextPage endCursor }
          }
        }
      }`,
            { variables: { id: themeId, after } }
        );
        const data = await response.json();
        const files = data.data?.theme?.files;
        if (!files) break;

        files.nodes.forEach((f: any) => {
            const match = f.filename.match(/^templates\/product\.(.+)\.json$/);
            if (match) suffixes.push(match[1]);
        });

        hasNextPage = files.pageInfo.hasNextPage;
        after = files.pageInfo.endCursor;
    }

    const options: TemplateOption[] = [{ label: "Default (no custom template)", value: "" }];
    suffixes.sort().forEach((s) => options.push({ label: s, value: s }));
    return options;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { admin } = await authenticate.admin(request);
    const url = new URL(request.url);
    const search = url.searchParams.get("q") || "";
    const searchQuery = search ? `title:*${search}*` : "";

    const [productsResponse, templates] = await Promise.all([
        admin.graphql(
            `#graphql
      query ListProducts($query: String) {
        products(first: 50, query: $query) {
          edges {
            node {
              id
              title
              templateSuffix
              featuredImage { url }
              metafield(namespace: "$app", key: "product_mode") { value }
            }
          }
        }
      }`,
            { variables: { query: searchQuery || null } }
        ),
        getProductTemplates(admin),
    ]);

    const productsData = await productsResponse.json();
    const products: ProductEntry[] = productsData.data.products.edges.map((edge: any) => ({
        id: edge.node.id,
        title: edge.node.title,
        imageUrl: edge.node.featuredImage?.url || "",
        mode: edge.node.metafield?.value || "unset",
        templateSuffix: edge.node.templateSuffix || "",
    }));

    return { products, search, templates };
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const { admin } = await authenticate.admin(request);
    const formData = await request.formData();
    const productId = String(formData.get("productId"));
    const mode = String(formData.get("mode"));
    const templateSuffix = String(formData.get("templateSuffix") || "");

    // Step 1: save the mode label (metafield)
    const metafieldResponse = await admin.graphql(
        `#graphql
    mutation SetProductMode($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id value }
        userErrors { field message }
      }
    }`,
        {
            variables: {
                metafields: [
                    {
                        ownerId: productId,
                        namespace: "$app",
                        key: "product_mode",
                        type: "single_line_text_field",
                        value: mode,
                    },
                ],
            },
        }
    );
    const metafieldData = await metafieldResponse.json();
    const metafieldErrors = metafieldData.data?.metafieldsSet?.userErrors;
    if (metafieldErrors?.length) return { error: metafieldErrors[0].message };

    // Step 2: assign the chosen theme template to this product
    const templateResponse = await admin.graphql(
        `#graphql
    mutation SetProductTemplate($product: ProductUpdateInput!) {
      productUpdate(product: $product) {
        product { id templateSuffix }
        userErrors { field message }
      }
    }`,
        {
            variables: {
                product: {
                    id: productId,
                    templateSuffix: templateSuffix || null,
                },
            },
        }
    );
    const templateData = await templateResponse.json();
    const templateErrors = templateData.data?.productUpdate?.userErrors;
    if (templateErrors?.length) return { error: templateErrors[0].message };

    return { success: true };
};

export default function ProductsSettingsPage() {
    const { products, search, templates } = useLoaderData<typeof loader>();
    const fetcher = useFetcher<typeof action>();
    const shopify = useAppBridge();
    const [searchParams, setSearchParams] = useSearchParams();
    const [searchInput, setSearchInput] = useState(search);
    const [selectedTemplates, setSelectedTemplates] = useState<Record<string, string>>({});

    useEffect(() => {
        if (fetcher.data && "success" in fetcher.data && fetcher.data.success) {
            shopify.toast.show("Product updated");
        }
        if (fetcher.data && "error" in fetcher.data && fetcher.data.error) {
            shopify.toast.show(fetcher.data.error, { isError: true });
        }
    }, [fetcher.data, shopify]);

    const setMode = (product: ProductEntry, mode: string) => {
        const templateSuffix = selectedTemplates[product.id] ?? product.templateSuffix;
        fetcher.submit({ productId: product.id, mode, templateSuffix }, { method: "post" });
    };

    const modeLabel = (mode: string) => {
        if (mode === "configurator") return "🎨 Configurator";
        if (mode === "preorder") return "📦 Preorder (Ready-to-Order)";
        return "— Not set —";
    };

    return (
        <s-page heading="Select Products">
            <s-section heading="Search & Manage">
                <s-link href="/app/settings">← Back to Settings</s-link>
                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        setSearchParams(searchInput ? { q: searchInput } : {});
                    }}
                >
                    <s-stack direction="inline" gap="base">
                        <input
                            type="text"
                            placeholder="Search products by title..."
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                            style={{ minWidth: "300px" }}
                        />
                        <s-button type="submit">Search</s-button>
                    </s-stack>
                </form>
            </s-section>

            <s-section heading={`Products (${products.length})`}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                        <tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
                            <th style={{ padding: "8px" }}>Image</th>
                            <th style={{ padding: "8px" }}>Title</th>
                            <th style={{ padding: "8px" }}>Current Mode</th>
                            <th style={{ padding: "8px" }}>Theme Template</th>
                            <th style={{ padding: "8px" }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {products.map((p) => (
                            <tr key={p.id} style={{ borderBottom: "1px solid #eee" }}>
                                <td style={{ padding: "8px" }}>
                                    {p.imageUrl ? <img src={p.imageUrl} alt={p.title} width={40} height={40} style={{ objectFit: "cover", borderRadius: 4 }} /> : "—"}
                                </td>
                                <td style={{ padding: "8px" }}>{p.title}</td>
                                <td style={{ padding: "8px" }}>{modeLabel(p.mode)}</td>
                                <td style={{ padding: "8px" }}>
                                    <select
                                        value={selectedTemplates[p.id] ?? p.templateSuffix}
                                        onChange={(e) =>
                                            setSelectedTemplates((prev) => ({ ...prev, [p.id]: e.target.value }))
                                        }
                                    >
                                        {templates.map((t) => (
                                            <option key={t.value} value={t.value}>
                                                {t.label}
                                            </option>
                                        ))}
                                    </select>
                                </td>
                                <td style={{ padding: "8px" }}>
                                    <s-stack direction="inline" gap="tight">
                                        <s-button
                                            variant={p.mode === "configurator" ? "primary" : "tertiary"}
                                            onClick={() => setMode(p, "configurator")}
                                        >
                                            Mark as Configurator
                                        </s-button>
                                        <s-button
                                            variant={p.mode === "preorder" ? "primary" : "tertiary"}
                                            onClick={() => setMode(p, "preorder")}
                                        >
                                            Mark as Preorder
                                        </s-button>
                                    </s-stack>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </s-section>
        </s-page>
    );
}