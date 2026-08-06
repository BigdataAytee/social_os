-- CreateTable
CREATE TABLE "x_suggestions" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "tab" "XStoryKind" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "why" TEXT NOT NULL,
    "cta" TEXT NOT NULL DEFAULT 'Use this',
    "payload" JSONB NOT NULL DEFAULT '{}',
    "usedAt" TIMESTAMP(3),
    "dismissed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "x_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "x_suggestions_orgId_tab_createdAt_idx" ON "x_suggestions"("orgId", "tab", "createdAt");

-- AddForeignKey
ALTER TABLE "x_suggestions" ADD CONSTRAINT "x_suggestions_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
