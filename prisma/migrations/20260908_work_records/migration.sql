CREATE TABLE IF NOT EXISTS "WorkRecord" (
  "workspace" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "payload" JSONB NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("workspace", "kind", "id")
);
