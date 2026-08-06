-- CreateEnum
CREATE TYPE "XStoryKind" AS ENUM ('SAVAGE', 'NEWS', 'GIST', 'TREND', 'VIDEO', 'CREATOR');

-- CreateEnum
CREATE TYPE "XPostRole" AS ENUM ('ORIGINAL', 'REPLY', 'EVIDENCE');

-- CreateTable
CREATE TABLE "x_posts" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "authorHandle" TEXT NOT NULL,
    "authorName" TEXT,
    "authorAvatarUrl" TEXT,
    "authorVerified" BOOLEAN NOT NULL DEFAULT false,
    "text" TEXT NOT NULL,
    "conversationId" TEXT,
    "replyToId" TEXT,
    "permalink" TEXT,
    "mediaType" TEXT NOT NULL DEFAULT 'text',
    "mediaUrls" TEXT[],
    "likes" INTEGER NOT NULL DEFAULT 0,
    "replies" INTEGER NOT NULL DEFAULT 0,
    "reposts" INTEGER NOT NULL DEFAULT 0,
    "views" INTEGER NOT NULL DEFAULT 0,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "x_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "x_stories" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "kind" "XStoryKind" NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "coverUrl" TEXT,
    "topics" TEXT[],
    "score" INTEGER NOT NULL DEFAULT 0,
    "scoring" JSONB NOT NULL DEFAULT '{}',
    "saved" BOOLEAN NOT NULL DEFAULT false,
    "savedAt" TIMESTAMP(3),
    "source" TEXT NOT NULL DEFAULT 'mock',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "x_stories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "x_story_posts" (
    "id" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "role" "XPostRole" NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "humour" INTEGER,
    "roast" INTEGER,
    "virality" INTEGER,
    "engagement" INTEGER,

    CONSTRAINT "x_story_posts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "x_posts_orgId_publishedAt_idx" ON "x_posts"("orgId", "publishedAt");

-- CreateIndex
CREATE INDEX "x_posts_orgId_conversationId_idx" ON "x_posts"("orgId", "conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "x_posts_orgId_externalId_key" ON "x_posts"("orgId", "externalId");

-- CreateIndex
CREATE INDEX "x_stories_orgId_kind_score_idx" ON "x_stories"("orgId", "kind", "score");

-- CreateIndex
CREATE INDEX "x_stories_orgId_saved_idx" ON "x_stories"("orgId", "saved");

-- CreateIndex
CREATE INDEX "x_story_posts_storyId_position_idx" ON "x_story_posts"("storyId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "x_story_posts_storyId_postId_key" ON "x_story_posts"("storyId", "postId");

-- AddForeignKey
ALTER TABLE "x_posts" ADD CONSTRAINT "x_posts_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "x_stories" ADD CONSTRAINT "x_stories_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "x_story_posts" ADD CONSTRAINT "x_story_posts_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "x_stories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "x_story_posts" ADD CONSTRAINT "x_story_posts_postId_fkey" FOREIGN KEY ("postId") REFERENCES "x_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
