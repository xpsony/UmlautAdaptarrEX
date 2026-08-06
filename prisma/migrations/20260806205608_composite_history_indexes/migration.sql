-- DropIndex
DROP INDEX "LogEntry_level_idx";

-- DropIndex
DROP INDEX "RenameHistory_mediaType_idx";

-- DropIndex
DROP INDEX "RequestHistory_domain_idx";

-- DropIndex
DROP INDEX "RequestHistory_type_idx";

-- CreateIndex
CREATE INDEX "LogEntry_level_createdAt_idx" ON "LogEntry"("level", "createdAt");

-- CreateIndex
CREATE INDEX "RenameHistory_mediaType_createdAt_idx" ON "RenameHistory"("mediaType", "createdAt");

-- CreateIndex
CREATE INDEX "RequestHistory_type_createdAt_idx" ON "RequestHistory"("type", "createdAt");

-- CreateIndex
CREATE INDEX "RequestHistory_domain_createdAt_idx" ON "RequestHistory"("domain", "createdAt");
