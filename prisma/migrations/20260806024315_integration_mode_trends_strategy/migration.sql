-- CreateEnum
CREATE TYPE "IntegrationMode" AS ENUM ('DIRECT', 'UNIFIED');

-- AlterTable
ALTER TABLE "connected_accounts" ADD COLUMN     "integrationMode" "IntegrationMode";

-- CreateTable
CREATE TABLE "trend_events" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "velocity" TEXT NOT NULL,
    "depth" TEXT NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trend_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trend_responses" (
    "id" TEXT NOT NULL,
    "trendEventId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "draftPostId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trend_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "strategy_recommendations" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "confidence" TEXT NOT NULL,
    "basedOnDataThrough" TIMESTAMP(3) NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "strategy_recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "trend_events_orgId_detectedAt_idx" ON "trend_events"("orgId", "detectedAt");

-- CreateIndex
CREATE INDEX "strategy_recommendations_orgId_platform_type_idx" ON "strategy_recommendations"("orgId", "platform", "type");

-- AddForeignKey
ALTER TABLE "trend_events" ADD CONSTRAINT "trend_events_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trend_responses" ADD CONSTRAINT "trend_responses_trendEventId_fkey" FOREIGN KEY ("trendEventId") REFERENCES "trend_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategy_recommendations" ADD CONSTRAINT "strategy_recommendations_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
