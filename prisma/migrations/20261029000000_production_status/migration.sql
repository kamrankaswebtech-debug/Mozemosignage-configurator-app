-- Production pipeline stage for every configurator order (dashboard + Production Orders page).
-- IF NOT EXISTS keeps it safe to run on any database; existing orders start as "NEW".
ALTER TABLE "ProductionBlueprint" ADD COLUMN IF NOT EXISTS "productionStatus" TEXT NOT NULL DEFAULT 'NEW';
ALTER TABLE "ProductionBlueprint" ADD COLUMN IF NOT EXISTS "statusUpdatedAt" TIMESTAMP(3);
