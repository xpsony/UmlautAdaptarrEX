-- CreateTable
CREATE TABLE "IndexerSetting" (
    "host" TEXT NOT NULL PRIMARY KEY,
    "tv" BOOLEAN NOT NULL,
    "movie" BOOLEAN NOT NULL,
    "audio" BOOLEAN NOT NULL,
    "book" BOOLEAN NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

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
    "audioVariationSearch" BOOLEAN NOT NULL DEFAULT true,
    "bookVariationSearch" BOOLEAN NOT NULL DEFAULT true,
    "maxTitleVariations" INTEGER NOT NULL DEFAULT 1,
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
INSERT INTO "new_Setting" ("appApiKey", "blockPrivateInstanceHosts", "cacheDurationMinutes", "csrfSecret", "forwardArrUserAgent", "fullSyncIntervalHours", "historyRetentionDays", "id", "indexerRateLimitMs", "indexerTimeoutSeconds", "logRetentionDays", "maxTitleVariations", "movieVariationSearch", "onDemandLookup", "operationMode", "pausedUntil", "prowlarrApiKey", "prowlarrHost", "proxyPassword", "proxyPort", "proxyUsername", "renameAttachExternalIds", "renameLegacySuffix", "renamePrefixGuard", "renameReleaseTagGuard", "renameStripSpecialChars", "renameYearGuard", "setupComplete", "syncIntervalMinutes", "titleApiHost", "tmdbApiKey", "tvVariationSearch", "tvdbApiKey", "tvdbPin", "userAgent") SELECT "appApiKey", "blockPrivateInstanceHosts", "cacheDurationMinutes", "csrfSecret", "forwardArrUserAgent", "fullSyncIntervalHours", "historyRetentionDays", "id", "indexerRateLimitMs", "indexerTimeoutSeconds", "logRetentionDays", "maxTitleVariations", "movieVariationSearch", "onDemandLookup", "operationMode", "pausedUntil", "prowlarrApiKey", "prowlarrHost", "proxyPassword", "proxyPort", "proxyUsername", "renameAttachExternalIds", "renameLegacySuffix", "renamePrefixGuard", "renameReleaseTagGuard", "renameStripSpecialChars", "renameYearGuard", "setupComplete", "syncIntervalMinutes", "titleApiHost", "tmdbApiKey", "tvVariationSearch", "tvdbApiKey", "tvdbPin", "userAgent" FROM "Setting";
DROP TABLE "Setting";
ALTER TABLE "new_Setting" RENAME TO "Setting";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Music and books followed the film switch until now. The RedefineTables block
-- above copies only rows that were already present, so any row visible here
-- belongs to an existing install and keeps its behaviour. On a fresh database
-- the table is empty, this UPDATE is a no-op, and the Setting row the setup
-- wizard creates later gets the `true` defaults.
UPDATE "Setting"
SET "audioVariationSearch" = "movieVariationSearch",
    "bookVariationSearch" = "movieVariationSearch";
