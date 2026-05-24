CREATE TABLE "LiveComment" (
  "id" TEXT NOT NULL,
  "liveSessionId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "LiveComment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LiveComment_liveSessionId_createdAt_idx" ON "LiveComment"("liveSessionId", "createdAt");
CREATE INDEX "LiveComment_userId_idx" ON "LiveComment"("userId");

ALTER TABLE "LiveComment" ADD CONSTRAINT "LiveComment_liveSessionId_fkey" FOREIGN KEY ("liveSessionId") REFERENCES "LiveSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LiveComment" ADD CONSTRAINT "LiveComment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
