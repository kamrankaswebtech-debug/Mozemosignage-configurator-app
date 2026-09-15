import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { Resend } from "resend";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { session } = await authenticate.admin(request);

    const records = await db.productionBlueprint.findMany({
        where: { shop: session.shop },
        orderBy: { createdAt: "desc" },
        select: {
            id: true,
            orderName: true,
            productTitle: true,
            quantity: true,
            customerName: true,
            customerEmail: true,
            destination: true,
            fileName: true,
            createdAt: true,
            emailSentAt: true,
            emailSentTo: true,
        },
    });

    return { records };
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const { session } = await authenticate.admin(request);
    const formData = await request.formData();
    const intent = formData.get("intent");
    const id = String(formData.get("id"));

    if (intent === "delete") {
        await db.productionBlueprint.delete({ where: { id } });
        return { ok: true };
    }

    if (intent === "send-email") {
        const email = String(formData.get("email") || "");
        const record = await db.productionBlueprint.findUnique({ where: { id } });
        if (!record || record.shop !== session.shop) {
            return { ok: false, error: "Blueprint not found" };
        }
        if (!email) {
            return { ok: false, error: "Email address required" };
        }

        const resend = new Resend(process.env.RESEND_API_KEY);
        const pdfBase64 = Buffer.from(record.pdfData).toString("base64");

        try {
            await resend.emails.send({
                from: process.env.RESEND_FROM_EMAIL || "Mozemo Signage <onboarding@resend.dev>",
                to: [email],
                subject: `Production Blueprint — Order ${record.orderName}`,
                html: `<p>Hi,</p><p>Please find attached the manufacturer production blueprint for order <strong>${record.orderName}</strong> (${record.productTitle}).</p><p>— Mozemo Signage</p>`,
                attachments: [{ filename: record.fileName, content: pdfBase64 }],
            });

            await db.productionBlueprint.update({
                where: { id },
                data: { emailSentAt: new Date(), emailSentTo: email },
            });

            return { ok: true };
        } catch (err: any) {
            console.error("Resend email failed:", err);
            return { ok: false, error: err?.message || "Failed to send email" };
        }
    }

    return { ok: false, error: "Unknown action" };
};

export default function ProductionOrders() {
    const { records } = useLoaderData<typeof loader>();
    const deleteFetcher = useFetcher();
    const emailFetchers: Record<string, ReturnType<typeof useFetcher>> = {};

    return (
        <s-page heading="Production Orders">
            <s-section heading="Manufacturer Blueprint PDFs">
                <s-paragraph>
                    Production-ready blueprint PDFs are automatically generated here for every order containing a configurator product.
                    Email them to the manufacturer, download them, or delete old records.

                </s-paragraph>

                {records.length === 0 && <s-paragraph>No blueprint has been generated yet.</s-paragraph>}

                <s-stack direction="block" gap="base">
                    {records.map((record) => (
                        <BlueprintRow key={record.id} record={record} deleteFetcher={deleteFetcher} />
                    ))}
                </s-stack>
            </s-section>
        </s-page>
    );
}

function BlueprintRow({ record, deleteFetcher }: { record: any; deleteFetcher: ReturnType<typeof useFetcher> }) {
    const emailFetcher = useFetcher();
    const isDeleting = deleteFetcher.state !== "idle" && deleteFetcher.formData?.get("id") === record.id;

    if (isDeleting) return null;

    return (
        <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="inline" gap="base" alignItems="center">
                <s-stack direction="block" gap="tight" style={{ flex: 1 }}>
                    <s-heading>
                        {record.orderName} — {record.productTitle}
                    </s-heading>
                    <s-paragraph>
                        {record.customerName} • Qty {record.quantity} • {record.destination}
                    </s-paragraph>
                    <s-paragraph>
                        {new Date(record.createdAt).toLocaleString("en-AU")}
                        {record.emailSentAt ? ` • Last emailed to ${record.emailSentTo}` : " • Not emailed yet"}
                    </s-paragraph>
                </s-stack>

                <s-link href={`/app/orders/${record.id}/download`} target="_blank">
                    Download PDF
                </s-link>

                <emailFetcher.Form method="post">
                    <input type="hidden" name="intent" value="send-email" />
                    <input type="hidden" name="id" value={record.id} />
                    <s-stack direction="inline" gap="tight" alignItems="center">
                        <s-text-field
                            name="email"
                            placeholder="customer@email.com"
                            defaultValue={record.customerEmail || ""}
                        ></s-text-field>
                        <s-button type="submit" variant="primary" {...(emailFetcher.state !== "idle" ? { loading: true } : {})}>
                            Send Email
                        </s-button>
                    </s-stack>
                </emailFetcher.Form>

                <deleteFetcher.Form method="post">
                    <input type="hidden" name="intent" value="delete" />
                    <input type="hidden" name="id" value={record.id} />
                    <s-button type="submit" variant="tertiary" tone="critical">
                        Delete
                    </s-button>
                </deleteFetcher.Form>
            </s-stack>

            {emailFetcher.data?.error && (
                <s-paragraph tone="critical">{emailFetcher.data.error}</s-paragraph>
            )}
            {emailFetcher.data?.ok && <s-paragraph tone="success">Email sent successfully.</s-paragraph>}
        </s-box>
    );
}