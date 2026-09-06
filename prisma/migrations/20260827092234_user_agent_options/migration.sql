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
INSERT INTO "new_Setting" ("appApiKey", "blockPrivateInstanceHosts", "cacheDurationMinutes", "csrfSecret", "historyRetentionDays", "id", "indexerRateLimitMs", "indexerTimeoutSeconds", "logRetentionDays", "operationMode", "pausedUntil", "prowlarrApiKey", "prowlarrHost", "proxyPassword", "proxyPort", "proxyUsername", "renameAttachExternalIds", "renameLegacySuffix", "renamePrefixGuard", "renameReleaseTagGuard", "renameStripSpecialChars", "renameYearGuard", "setupComplete", "titleApiHost", "tmdbApiKey", "tvdbApiKey", "tvdbPin", "userAgent") SELECT "appApiKey", "blockPrivateInstanceHosts", "cacheDurationMinutes", "csrfSecret", "historyRetentionDays", "id", "indexerRateLimitMs", "indexerTimeoutSeconds", "logRetentionDays", "operationMode", "pausedUntil", "prowlarrApiKey", "prowlarrHost", "proxyPassword", "proxyPort", "proxyUsername", "renameAttachExternalIds", "renameLegacySuffix", "renamePrefixGuard", "renameReleaseTagGuard", "renameStripSpecialChars", "renameYearGuard", "setupComplete", "titleApiHost", "tmdbApiKey", "tvdbApiKey", "tvdbPin", "userAgent" FROM "Setting";
DROP TABLE "Setting";
ALTER TABLE "new_Setting" RENAME TO "Setting";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Free existing installations from the stale hard-coded default.
--
-- `userAgent` used to BE the value, defaulting to the literal
-- 'UmlautAdaptarrEX/2.0' - a string that was already wrong (the 2.0 rewrite
-- ships as 1.x) and that nobody chose. The column is now an *override*, and
-- an empty value means "automatic: UmlautAdaptarrEX/<running version>".
--
-- Clearing exactly the untouched historical defaults migrates those installs
-- onto the automatic value. A UA the operator actually customised does not
-- match any of these literals and is left alone.
UPDATE "Setting"
SET "userAgent" = ''
WHERE trim("userAgent") IN (
  'UmlautAdaptarrEX/2.0',
  'UmlautAdaptarr/2.0'
);
