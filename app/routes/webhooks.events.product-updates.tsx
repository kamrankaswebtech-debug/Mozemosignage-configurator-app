import type { ActionFunctionArgs } from "react-router";

// Stub handler for the Events subscription required by shopify.app.toml.
// This satisfies the CLI's schema validation and does nothing else for now.
export const action = async ({ request }: ActionFunctionArgs) => {
    console.log("Events delivery received:", request.url);
    return new Response(null, { status: 200 });
};