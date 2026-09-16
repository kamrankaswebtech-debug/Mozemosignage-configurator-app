import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";

export const loader = async ({ params }: LoaderFunctionArgs) => {
    const record = await db.productionBlueprint.findUnique({
        where: { shareToken: params.token },
    });

    if (!record) {
        throw new Response("Not found", { status: 404 });
    }

    return new Response(record.pdfData, {
        headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `inline; filename="${record.fileName}"`,
        },
    });
};