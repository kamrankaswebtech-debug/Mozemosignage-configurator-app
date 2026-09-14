import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
    await authenticate.admin(request);

    const record = await db.productionBlueprint.findUnique({
        where: { id: params.id },
    });

    if (!record) {
        throw new Response("Not found", { status: 404 });
    }

    return new Response(record.pdfData, {
        headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="${record.fileName}"`,
        },
    });
};