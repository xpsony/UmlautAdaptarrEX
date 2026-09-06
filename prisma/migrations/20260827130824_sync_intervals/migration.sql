-- AlterTable
ALTER TABLE "ArrInstance" ADD COLUMN "lastFullSyncAt" DATETIME;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Setting" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "appApiKey" TEXT NOT NULL,
    "proxyPort" INTEGER NOT NULL DEFAULT 5006,
    "proxyUsername" TEXT NOT NULL DEFAULT 'UmlautAdaptarr',
    "proxyPassword" TEXT NOT NULL DEFAULT '',
    "cacheDurationMinutes" INTEGER NOT NULL DEFAULT 12,
    "titleApiHost" TEXT NOT NULL DEFAULT 'https://umlautadaptarr.pcjones.de/api/v1',
    "tmdbApiKey" TEXT,
    "tvdbApiKey" TEXT,
    "tvdbPin" TEXT,
    "userAgent" TEXT NOT NULL DEFAULT '',
    "forwardArrUserAgent" BOOLEAN NOT NULL DEFAULT false,
    "setupComplete" BOOLEAN NOT NULL DEFAULT false,
    "prowlarrHost" TEXT,
    "prowlarrApiKey" TEXT,
    "logRetentionDays" INTEGER NOT NULL DEFAULT 3,
    "historyRetentionDays" INTEGER NOT NULL DEFAULT 30,
    "indexerRateLimitMs" INTEGER NOT NULL DEFAULT 500,
    "indexerTimeoutSeconds" INTEGER NOT NULL DEFAULT 60,
    "syncIntervalMinutes" INTEGER NOT NULL DEFAULT 10,
    "fullSyncIntervalHours" INTEGER NOT NULL DEFAULT 24,
    "onDemandLookup" BOOLEAN NOT NULL DEFAULT true,
    "tvVariationSearch" BOOLEAN NOT NULL DEFAULT true,
    "movieVariationSearch" BOOLEAN NOT NULL DEFAULT true,
    "maxTitleVariations" INTEGER NOT NULL DEFAULT 3,
    "csrfSecret" TEXT,
    "operationMode" TEXT NOT NULL DEFAULT 'proxy',
    "pausedUntil" DATETIME,
    "blockPrivateInstanceHosts" BOOLEAN NOT NULL DEFAULT false,
    "renameYearGuard" BOOLEAN NOT NULL DEFAULT true,
    "renamePrefixGuard" BOOLEAN NOT NULL DEFAULT true,
    "renameReleaseTagGuard" BOOLEAN NOT NULL DEFAULT true,
    "renameLegacySuffix" BOOLEAN NOT NULL DEFAULT false,
    "renameStripSpecialChars" BOOLEAN NOT NULL DEFAULT true,
    "renameAttachExternalIds" BOOLEAN NOT NULL DEFAULT true
);
INSERT INTO "new_Setting" ("appApiKey", "blockPrivateInstanceHosts", "cacheDurationMinutes", "csrfSecret", "forwardArrUserAgent", "historyRetentionDays", "id", "indexerRateLimitMs", "indexerTimeoutSeconds", "logRetentionDays", "operationMode", "pausedUntil", "prowlarrApiKey", "prowlarrHost", "proxyPassword", "proxyPort", "proxyUsername", "renameAttachExternalIds", "renameLegacySuffix", "renamePrefixGuard", "renameReleaseTagGuard", "renameStripSpecialChars", "renameYearGuard", "setupComplete", "titleApiHost", "tmdbApiKey", "tvdbApiKey", "tvdbPin", "userAgent") SELECT "appApiKey", "blockPrivateInstanceHosts", "cacheDurationMinutes", "csrfSecret", "forwardArrUserAgent", "historyRetentionDays", "id", "indexerRateLimitMs", "indexerTimeoutSeconds", "logRetentionDays", "operationMode", "pausedUntil", "prowlarrApiKey", "prowlarrHost", "proxyPassword", "proxyPort", "proxyUsername", "renameAttachExternalIds", "renameLegacySuffix", "renamePrefixGuard", "renameReleaseTagGuard", "renameStripSpecialChars", "renameYearGuard", "setupComplete", "titleApiHost", "tmdbApiKey", "tvdbApiKey", "tvdbPin", "userAgent" FROM "Setting";
DROP TABLE "Setting";
ALTER TABLE "new_Setting" RENAME TO "Setting";
CREATE TABLE "new_SyncRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "arrInstanceId" TEXT,
    "status" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'full',
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "itemsCount" INTEGER NOT NULL DEFAULT 0,
    "pcjonesItemsCount" INTEGER NOT NULL DEFAULT 0,
    "tmdbItemsCount" INTEGER NOT NULL DEFAULT 0,
    "tvdbItemsCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    CONSTRAINT "SyncRun_arrInstanceId_fkey" FOREIGN KEY ("arrInstanceId") REFERENCES "ArrInstance" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_SyncRun" ("arrInstanceId", "errorMessage", "finishedAt", "id", "itemsCount", "pcjonesItemsCount", "startedAt", "status", "tmdbItemsCount", "tvdbItemsCount") SELECT "arrInstanceId", "errorMessage", "finishedAt", "id", "itemsCount", "pcjonesItemsCount", "startedAt", "status", "tmdbItemsCount", "tvdbItemsCount" FROM "SyncRun";
DROP TABLE "SyncRun";
ALTER TABLE "new_SyncRun" RENAME TO "SyncRun";
CREATE INDEX "SyncRun_startedAt_idx" ON "SyncRun"("startedAt");
CREATE INDEX "SyncRun_status_idx" ON "SyncRun"("status");
CREATE INDEX "SyncRun_arrInstanceId_startedAt_idx" ON "SyncRun"("arrInstanceId", "startedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Existing installations keep today's behaviour for the ONE new setting that
-- would otherwise increase their outbound load without being asked:
-- movieVariationSearch. Films never had a variation fan-out (the movie route
-- deliberately passed searchItem=null), so switching it on would multiply the
-- indexer requests per film search - a setup with tight indexer limits could
-- walk into a rate limit purely from upgrading.
--
-- The RedefineTables block above copies only rows that were already present,
-- so any row visible here belongs to a pre-existing install. On a fresh
-- database the table is empty, this UPDATE is a no-op, and the Setting row
-- created later by the setup wizard picks up the `true` default.
--
-- The other five new columns are deliberately NOT pinned:
--   onDemandLookup / tvVariationSearch  - true is the existing behaviour or
--                                         the explicitly recommended mode
--   maxTitleVariations = 3              - strictly LESS indexer load than the
--                                         hard-coded 10 it replaces
--   syncIntervalMinutes / fullSyncIntervalHours
--                                       - the new default cadence is the
--                                         point of the change, and an empty
--                                         quick sync writes nothing
UPDATE "Setting"
SET "movieVariationSearch" = false;
