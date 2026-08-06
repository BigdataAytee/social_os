-- CreateEnum
CREATE TYPE "MonitorKind" AS ENUM ('KEYWORD', 'BRAND', 'COMPETITOR');

-- CreateEnum
CREATE TYPE "MentionSource" AS ENUM ('INBOX', 'OWN_POST', 'COMPETITOR');

-- AlterTable
ALTER TABLE "competitors" ADD COLUMN     "displayName" TEXT,
ADD COLUMN     "lastSyncAt" TIMESTAMP(3),
ADD COLUMN     "lastSyncError" TEXT;

-- CreateTable
CREATE TABLE "competitor_posts" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "competitorId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "permalink" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "comments" INTEGER NOT NULL DEFAULT 0,
    "shares" INTEGER NOT NULL DEFAULT 0,
    "views" INTEGER NOT NULL DEFAULT 0,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "competitor_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monitors" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "kind" "MonitorKind" NOT NULL DEFAULT 'KEYWORD',
    "platform" "Platform",
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "monitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mentions" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "monitorId" TEXT NOT NULL,
    "source" "MentionSource" NOT NULL,
    "platform" "Platform" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "authorHandle" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "permalink" TEXT,
    "sentiment" "Sentiment" NOT NULL DEFAULT 'NEUTRAL',
    "reach" INTEGER NOT NULL DEFAULT 0,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mentions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "competitor_posts_orgId_publishedAt_idx" ON "competitor_posts"("orgId", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "competitor_posts_competitorId_externalId_key" ON "competitor_posts"("competitorId", "externalId");

-- CreateIndex
CREATE INDEX "monitors_orgId_active_idx" ON "monitors"("orgId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "monitors_orgId_term_kind_key" ON "monitors"("orgId", "term", "kind");

-- CreateIndex
CREATE INDEX "mentions_orgId_publishedAt_idx" ON "mentions"("orgId", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "mentions_monitorId_source_sourceId_key" ON "mentions"("monitorId", "source", "sourceId");

-- AddForeignKey
ALTER TABLE "competitor_posts" ADD CONSTRAINT "competitor_posts_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "competitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitors" ADD CONSTRAINT "monitors_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mentions" ADD CONSTRAINT "mentions_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "monitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
