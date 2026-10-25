-- The single variation cap `maxTitleVariations` becomes one cap per media
-- type, on the global Setting row and on every per-indexer row.
--
-- Nothing changes for existing installations: the Setting redefine copies the
-- old cap into all four new columns, and existing IndexerSetting rows take the
-- same global cap (the redefine runs before the Setting table is rebuilt, so
-- the old column is still readable). Fresh installs get the column default 1,
-- which is what the single cap defaulted to as well.

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_IndexerSetting" (
    "host" TEXT NOT NULL PRIMARY KEY,
    "tv" BOOLEAN NOT NULL,
    "movie" BOOLEAN NOT NULL,
    "audio" BOOLEAN NOT NULL,
    "book" BOOLEAN NOT NULL,
    "tvMax" INTEGER NOT NULL DEFAULT 1,
    "movieMax" INTEGER NOT NULL DEFAULT 1,
    "audioMax" INTEGER NOT NULL DEFAULT 1,
    "bookMax" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_IndexerSetting" ("audio", "audioMax", "book", "bookMax", "host", "movie", "movieMax", "tv", "tvMax", "updatedAt")
SELECT "audio", COALESCE((SELECT "maxTitleVariations" FROM "Setting" WHERE "id" = 1), 1), "book", COALESCE((SELECT "maxTitleVariations" FROM "Setting" WHERE "id" = 1), 1), "host", "movie", COALESCE((SELECT "maxTitleVariations" FROM "Setting" WHERE "id" = 1), 1), "tv", COALESCE((SELECT "maxTitleVariations" FROM "Setting" WHERE "id" = 1), 1), "updatedAt" FROM "IndexerSetting";
DROP TABLE "IndexerSetting";
ALTER TABLE "new_IndexerSetting" RENAME TO "IndexerSetting";
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
    "tvMaxTitleVariations" INTEGER NOT NULL DEFAULT 1,
    "movieMaxTitleVariations" INTEGER NOT NULL DEFAULT 1,
    "audioMaxTitleVariations" INTEGER NOT NULL DEFAULT 1,
    "bookMaxTitleVariations" INTEGER NOT NULL DEFAULT 1,
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
INSERT INTO "new_Setting" ("appApiKey", "audioVariationSearch", "blockPrivateInstanceHosts", "bookVariationSearch", "cacheDurationMinutes", "csrfSecret", "forwardArrUserAgent", "fullSyncIntervalHours", "historyRetentionDays", "id", "indexerRateLimitMs", "indexerTimeoutSeconds", "logRetentionDays", "movieVariationSearch", "onDemandLookup", "operationMode", "pausedUntil", "prowlarrApiKey", "prowlarrHost", "proxyPassword", "proxyPort", "proxyUsername", "renameAttachExternalIds", "renameLegacySuffix", "renamePrefixGuard", "renameReleaseTagGuard", "renameStripSpecialChars", "renameYearGuard", "setupComplete", "syncIntervalMinutes", "titleApiHost", "tmdbApiKey", "tvVariationSearch", "tvdbApiKey", "tvdbPin", "userAgent", "tvMaxTitleVariations", "movieMaxTitleVariations", "audioMaxTitleVariations", "bookMaxTitleVariations") SELECT "appApiKey", "audioVariationSearch", "blockPrivateInstanceHosts", "bookVariationSearch", "cacheDurationMinutes", "csrfSecret", "forwardArrUserAgent", "fullSyncIntervalHours", "historyRetentionDays", "id", "indexerRateLimitMs", "indexerTimeoutSeconds", "logRetentionDays", "movieVariationSearch", "onDemandLookup", "operationMode", "pausedUntil", "prowlarrApiKey", "prowlarrHost", "proxyPassword", "proxyPort", "proxyUsername", "renameAttachExternalIds", "renameLegacySuffix", "renamePrefixGuard", "renameReleaseTagGuard", "renameStripSpecialChars", "renameYearGuard", "setupComplete", "syncIntervalMinutes", "titleApiHost", "tmdbApiKey", "tvVariationSearch", "tvdbApiKey", "tvdbPin", "userAgent", "maxTitleVariations", "maxTitleVariations", "maxTitleVariations", "maxTitleVariations" FROM "Setting";
DROP TABLE "Setting";
ALTER TABLE "new_Setting" RENAME TO "Setting";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

