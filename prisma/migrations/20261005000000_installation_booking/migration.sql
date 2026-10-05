-- Installation booking system.
-- Written with IF NOT EXISTS so it is safe on BOTH the existing database and a brand-new one.
-- "ProductionBlueprint" is included because 0_init never created it (it was originally
-- created outside migrations), so a fresh database would otherwise be missing it.

-- CreateTable
CREATE TABLE IF NOT EXISTS "ProductionBlueprint" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "orderName" TEXT NOT NULL,
    "orderNumber" INTEGER,
    "lineItemId" TEXT NOT NULL,
    "productTitle" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "customerName" TEXT,
    "customerEmail" TEXT,
    "destination" TEXT,
    "orderStatus" TEXT,
    "propertiesJson" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "pdfData" BYTEA NOT NULL,
    "shareToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "emailSentAt" TIMESTAMP(3),
    "emailSentTo" TEXT,

    CONSTRAINT "ProductionBlueprint_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProductionBlueprint_shareToken_key" ON "ProductionBlueprint"("shareToken");
CREATE INDEX IF NOT EXISTS "ProductionBlueprint_shop_idx" ON "ProductionBlueprint"("shop");
CREATE INDEX IF NOT EXISTS "ProductionBlueprint_shopifyOrderId_idx" ON "ProductionBlueprint"("shopifyOrderId");

-- CreateTable
CREATE TABLE IF NOT EXISTS "InstallationBooking" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "timeSlot" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'HOLD',
    "holdToken" TEXT NOT NULL,
    "holdExpiresAt" TIMESTAMP(3),
    "address" TEXT,
    "distanceKm" DOUBLE PRECISION,
    "shopifyOrderId" TEXT,
    "orderName" TEXT,
    "customerName" TEXT,
    "customerEmail" TEXT,
    "customerPhone" TEXT,
    "productTitle" TEXT,
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstallationBooking_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "InstallationBooking_holdToken_key" ON "InstallationBooking"("holdToken");
CREATE INDEX IF NOT EXISTS "InstallationBooking_shop_date_idx" ON "InstallationBooking"("shop", "date");
CREATE INDEX IF NOT EXISTS "InstallationBooking_shopifyOrderId_idx" ON "InstallationBooking"("shopifyOrderId");
CREATE UNIQUE INDEX IF NOT EXISTS "InstallationBooking_shop_date_timeSlot_key" ON "InstallationBooking"("shop", "date", "timeSlot");
