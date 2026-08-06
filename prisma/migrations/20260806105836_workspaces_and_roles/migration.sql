-- CreateEnum
CREATE TYPE "OrgKind" AS ENUM ('BRAND', 'CLIENT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "Role" ADD VALUE 'CREATOR';
ALTER TYPE "Role" ADD VALUE 'CLIENT';

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "branding" JSONB,
ADD COLUMN     "kind" "OrgKind" NOT NULL DEFAULT 'BRAND',
ADD COLUMN     "parentOrgId" TEXT;

-- CreateIndex
CREATE INDEX "organizations_parentOrgId_idx" ON "organizations"("parentOrgId");

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_parentOrgId_fkey" FOREIGN KEY ("parentOrgId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
