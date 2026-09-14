import {
    Document,
    Page,
    Text,
    View,
    StyleSheet,
    Svg,
    Line,
    Rect,
    Image,
    renderToBuffer,
} from "@react-pdf/renderer";
import React from "react";

export interface BlueprintProperty {
    name: string;
    value: string;
}

export interface BlueprintData {
    orderName: string;
    orderNumber: string | number;
    orderDate: string;
    customerName: string;
    status: string;
    productTitle: string;
    quantity: number;
    destination: string;
    properties: BlueprintProperty[];
    widthCm?: number;
    heightCm?: number;
    referenceImageUrl?: string;
    fileName: string;
}

const styles = StyleSheet.create({
    page: {
        padding: 32,
        fontSize: 9,
        fontFamily: "Helvetica",
        color: "#1a1a1a",
    },
    headerRow: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        borderBottom: "2 solid #1a1a1a",
        paddingBottom: 8,
        marginBottom: 16,
    },
    brand: { fontSize: 14, fontWeight: 700, letterSpacing: 1 },
    headerSub: { fontSize: 7, color: "#666666", marginTop: 2 },
    headerRight: { fontSize: 7, color: "#666666", textAlign: "right" },
    h1: { fontSize: 18, fontWeight: 700, marginBottom: 2 },
    h1sub: { fontSize: 8, color: "#666666", marginBottom: 14 },
    metaGrid: {
        flexDirection: "row",
        flexWrap: "wrap",
        borderTop: "1 solid #dddddd",
        borderBottom: "1 solid #dddddd",
        paddingVertical: 8,
        marginBottom: 16,
    },
    metaItem: { width: "33%", marginBottom: 6 },
    metaLabel: { fontSize: 6.5, color: "#888888", textTransform: "uppercase", letterSpacing: 0.5 },
    metaValue: { fontSize: 9, fontWeight: 700, marginTop: 1 },
    sectionTitle: {
        fontSize: 10,
        fontWeight: 700,
        marginBottom: 8,
        marginTop: 10,
        textTransform: "uppercase",
        letterSpacing: 0.5,
    },
    propRow: {
        flexDirection: "row",
        borderBottom: "0.5 solid #eeeeee",
        paddingVertical: 4,
    },
    propLabel: { width: "38%", fontSize: 8.5, color: "#555555" },
    propValue: { width: "62%", fontSize: 8.5, fontWeight: 700 },
    noteItem: { fontSize: 8, marginBottom: 4, color: "#333333" },
    footerBar: {
        position: "absolute",
        bottom: 18,
        left: 32,
        right: 32,
        fontSize: 6.5,
        color: "#999999",
        borderTop: "0.5 solid #dddddd",
        paddingTop: 6,
        flexDirection: "row",
        justifyContent: "space-between",
    },
    drawingBox: {
        border: "1 solid #1a1a1a",
        marginTop: 30,
        marginBottom: 30,
        height: 220,
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
    },
    specTable: {
        borderTop: "1 solid #1a1a1a",
        marginTop: 10,
    },
    specRow: {
        flexDirection: "row",
        borderBottom: "0.5 solid #dddddd",
        paddingVertical: 5,
    },
    specLabel: { width: "32%", fontSize: 8, color: "#555555", fontWeight: 700 },
    specValue: { width: "68%", fontSize: 8 },
    checklistItem: { flexDirection: "row", fontSize: 8.5, marginBottom: 6, alignItems: "center" },
    checkbox: {
        width: 9,
        height: 9,
        border: "1 solid #1a1a1a",
        marginRight: 8,
    },
    refBox: {
        border: "1 dashed #999999",
        height: 260,
        marginBottom: 16,
        alignItems: "center",
        justifyContent: "center",
    },
});

function findProp(properties: BlueprintProperty[], candidates: string[]): string {
    for (const c of candidates) {
        const found = properties.find((p) => p.name.toLowerCase() === c.toLowerCase());
        if (found && found.value) return found.value;
    }
    return "Manufacturer to confirm";
}

function PageFooter({ page, brand }: { page: number; brand: string }) {
    return (
        <View style={styles.footerBar} fixed>
            <Text>{brand}</Text>
            <Text>MANUFACTURER BLUEPRINT • INTERNAL PRODUCTION DOCUMENT — PAGE {page}</Text>
        </View>
    );
}

function BlueprintDocument({ data }: { data: BlueprintData }) {
    const textValue = findProp(data.properties, ["Custom Text", "Text", "Your Text"]);
    const widthMm = data.widthCm ? Math.round(data.widthCm * 10) : undefined;
    const heightMm = data.heightCm ? Math.round(data.heightCm * 10) : undefined;
    const visibleProperties = data.properties.filter((p) => !p.name.startsWith("_"));

    return (
        <Document>
            {/* PAGE 1 — Order Summary + Customer Specifications + Production Notes */}
            <Page size="A4" style={styles.page}>
                <View style={styles.headerRow}>
                    <View>
                        <Text style={styles.brand}>MOZEMO SIGNAGE</Text>
                    </View>
                    <Text style={styles.headerRight}>MANUFACTURER BLUEPRINT{"\n"}INTERNAL PRODUCTION DOCUMENT</Text>
                </View>

                <Text style={styles.h1}>MANUFACTURER BLUEPRINT</Text>
                <Text style={styles.h1sub}>Production-ready order summary for Mozemo Signage manufacturing.</Text>

                <View style={styles.metaGrid}>
                    <View style={styles.metaItem}>
                        <Text style={styles.metaLabel}>ORDER #</Text>
                        <Text style={styles.metaValue}>{data.orderName}</Text>
                    </View>
                    <View style={styles.metaItem}>
                        <Text style={styles.metaLabel}>DATE</Text>
                        <Text style={styles.metaValue}>{data.orderDate}</Text>
                    </View>
                    <View style={styles.metaItem}>
                        <Text style={styles.metaLabel}>CUSTOMER</Text>
                        <Text style={styles.metaValue}>{data.customerName}</Text>
                    </View>
                    <View style={styles.metaItem}>
                        <Text style={styles.metaLabel}>STATUS</Text>
                        <Text style={styles.metaValue}>{data.status}</Text>
                    </View>
                    <View style={styles.metaItem}>
                        <Text style={styles.metaLabel}>PRODUCT</Text>
                        <Text style={styles.metaValue}>{data.productTitle}</Text>
                    </View>
                    <View style={styles.metaItem}>
                        <Text style={styles.metaLabel}>QTY</Text>
                        <Text style={styles.metaValue}>{data.quantity}</Text>
                    </View>
                    <View style={styles.metaItem}>
                        <Text style={styles.metaLabel}>DELIVERY</Text>
                        <Text style={styles.metaValue}>{data.destination}</Text>
                    </View>
                </View>

                <Text style={styles.sectionTitle}>1. Customer-Specified Options</Text>
                {visibleProperties.length === 0 ? (
                    <Text style={styles.noteItem}>No custom properties recorded for this item.</Text>
                ) : (
                    visibleProperties.map((p, i) => (
                        <View style={styles.propRow} key={i}>
                            <Text style={styles.propLabel}>{p.name}</Text>
                            <Text style={styles.propValue}>{p.value}</Text>
                        </View>
                    ))
                )}

                <Text style={styles.sectionTitle}>2. Production Notes</Text>
                <Text style={styles.noteItem}>• Use the attached customer artwork/reference (page 3) as the visual reference for the finished sign.</Text>
                <Text style={styles.noteItem}>• Do not manufacture from the visual mock-up alone where dimensions, mounting or electrical details are unclear.</Text>
                <Text style={styles.noteItem}>• Confirm final artwork, dimensions, materials, LED configuration and mounting method before cutting or assembly.</Text>
                <Text style={styles.noteItem}>• All visible surfaces must be clean, scratch-free and professionally finished.</Text>

                <PageFooter page={1} brand="MOZEMO SIGNAGE" />
            </Page>

            {/* PAGE 2 — Technical Blueprint */}
            <Page size="A4" style={styles.page}>
                <View style={styles.headerRow}>
                    <Text style={styles.brand}>MOZEMO SIGNAGE</Text>
                    <Text style={styles.headerRight}>MANUFACTURER BLUEPRINT{"\n"}INTERNAL PRODUCTION DOCUMENT</Text>
                </View>

                <Text style={styles.h1}>SIGN BLUEPRINT</Text>
                <Text style={styles.h1sub}>Technical layout — replace values with the customer&apos;s confirmed production specifications.</Text>

                <View style={styles.drawingBox}>
                    <Text style={{ fontSize: 22, fontWeight: 700 }}>{textValue}</Text>
                    {widthMm && (
                        <Svg width="100%" height="16" style={{ position: "absolute", bottom: 4, left: 0 }}>
                            <Line x1="20" y1="8" x2="90%" y2="8" stroke="#1a1a1a" strokeWidth={1} />
                        </Svg>
                    )}
                    {widthMm && (
                        <Text style={{ position: "absolute", bottom: -14, alignSelf: "center", fontSize: 7 }}>
                            {widthMm} mm OVERALL WIDTH
                        </Text>
                    )}
                    {heightMm && (
                        <Text style={{ position: "absolute", right: -6, top: "45%", fontSize: 7 }}>{heightMm} mm</Text>
                    )}
                </View>

                <Text style={{ fontSize: 8, color: "#888888", marginBottom: 2 }}>
                    DRAWING REF. MS-{data.orderNumber}-{data.fileName.slice(-6, -4)}
                </Text>

                <View style={styles.specTable}>
                    <View style={styles.specRow}>
                        <Text style={styles.specLabel}>OVERALL SIZE</Text>
                        <Text style={styles.specValue}>{widthMm && heightMm ? `${widthMm} W × ${heightMm} H mm` : findProp(data.properties, ["Size"])}</Text>
                    </View>
                    <View style={styles.specRow}>
                        <Text style={styles.specLabel}>TEXT / ARTWORK</Text>
                        <Text style={styles.specValue}>{textValue}</Text>
                    </View>
                    <View style={styles.specRow}>
                        <Text style={styles.specLabel}>ILLUMINATION</Text>
                        <Text style={styles.specValue}>{findProp(data.properties, ["Illumination Type", "Illumination"])}</Text>
                    </View>
                    <View style={styles.specRow}>
                        <Text style={styles.specLabel}>MATERIAL</Text>
                        <Text style={styles.specValue}>{findProp(data.properties, ["Material"])}</Text>
                    </View>
                    <View style={styles.specRow}>
                        <Text style={styles.specLabel}>LED / POWER</Text>
                        <Text style={styles.specValue}>Manufacturer to confirm specification</Text>
                    </View>
                    <View style={styles.specRow}>
                        <Text style={styles.specLabel}>MOUNTING</Text>
                        <Text style={styles.specValue}>{findProp(data.properties, ["Mounting"])}</Text>
                    </View>
                    <View style={styles.specRow}>
                        <Text style={styles.specLabel}>TOLERANCE</Text>
                        <Text style={styles.specValue}>Final production tolerance to be confirmed</Text>
                    </View>
                </View>

                <Text style={{ fontSize: 7, color: "#999999", marginTop: 16 }}>
                    IMPORTANT: This is a production template, not a manufacturing instruction. Final dimensions, electrical
                    specifications, materials and fixing details should only be treated as approved after confirmation.
                </Text>

                <PageFooter page={2} brand="MOZEMO SIGNAGE" />
            </Page>

            {/* PAGE 3 — Customer Reference & QC */}
            <Page size="A4" style={styles.page}>
                <View style={styles.headerRow}>
                    <Text style={styles.brand}>MOZEMO SIGNAGE</Text>
                    <Text style={styles.headerRight}>MANUFACTURER BLUEPRINT{"\n"}INTERNAL PRODUCTION DOCUMENT</Text>
                </View>

                <Text style={styles.h1}>CUSTOMER REFERENCE &amp; QC</Text>
                <Text style={styles.h1sub}>
                    Keep the customer&apos;s visual reference together with the blueprint so the manufacturer receives one
                    complete production pack.
                </Text>

                <Text style={{ fontSize: 8, fontWeight: 700, marginBottom: 6 }}>CUSTOMER PHOTO / REFERENCE IMAGE</Text>
                <View style={styles.refBox}>
                    {data.referenceImageUrl ? (
                        <Image src={data.referenceImageUrl} style={{ maxWidth: "90%", maxHeight: "90%" }} />
                    ) : (
                        <Text style={{ fontSize: 8, color: "#999999" }}>No reference image uploaded for this item.</Text>
                    )}
                </View>

                <Text style={{ fontSize: 8, fontWeight: 700, marginBottom: 8 }}>MANUFACTURER CHECKLIST</Text>
                {[
                    "Customer artwork/reference received",
                    "Text spelling checked against order",
                    "Dimensions confirmed",
                    "Font/style confirmed",
                    "Illumination type confirmed",
                    "Material and finish confirmed",
                    "Power supply / electrical specification confirmed",
                    "Mounting / fixing method confirmed",
                    "Production proof approved before manufacture",
                    "Final QC completed before dispatch",
                ].map((item, i) => (
                    <View style={styles.checklistItem} key={i}>
                        <View style={styles.checkbox} />
                        <Text>{item}</Text>
                    </View>
                ))}

                <PageFooter page={3} brand="MOZEMO SIGNAGE" />
            </Page>
        </Document>
    );
}

export async function generateBlueprintPdfBuffer(data: BlueprintData): Promise<Buffer> {
    return renderToBuffer(<BlueprintDocument data={data} />);
}