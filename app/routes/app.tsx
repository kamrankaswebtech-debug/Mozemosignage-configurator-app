import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">Dashboard</s-link>
        <s-link href="/app/neon-signs">Neon Signs</s-link>
        <s-link href="/app/3d-signs">3D Illuminated Signs</s-link>
        <s-link href="/app/uv-graphic-led">UV Graphic LED Signs</s-link>
        <s-link href="/app/uv-graphic-no-led">UV Graphic Signs (No LED)</s-link>
        <s-link href="/app/infinity-mirror">Infinity Mirror Signs</s-link>
        <s-link href="/app/event-marquee">Event Marquee Signs</s-link>
        <s-link href="/app/bundle-deals">Bulk & Bundle Deals</s-link>
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
