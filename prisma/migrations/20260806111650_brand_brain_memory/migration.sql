-- CreateTable
CREATE TABLE "brand_profiles" (
    "orgId" TEXT NOT NULL,
    "vocabulary" JSONB NOT NULL DEFAULT '{}',
    "sentenceStats" JSONB NOT NULL DEFAULT '{}',
    "emojiRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "hookPatterns" JSONB NOT NULL DEFAULT '[]',
    "contentPillars" JSONB NOT NULL DEFAULT '[]',
    "winningFormats" JSONB NOT NULL DEFAULT '[]',
    "basedOnPosts" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brand_profiles_pkey" PRIMARY KEY ("orgId")
);

-- CreateTable
CREATE TABLE "memory_chunks" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "score" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memory_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "memory_chunks_orgId_sourceType_idx" ON "memory_chunks"("orgId", "sourceType");

-- CreateIndex
CREATE UNIQUE INDEX "memory_chunks_orgId_sourceType_sourceId_key" ON "memory_chunks"("orgId", "sourceType", "sourceId");

-- AddForeignKey
ALTER TABLE "brand_profiles" ADD CONSTRAINT "brand_profiles_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_chunks" ADD CONSTRAINT "memory_chunks_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
