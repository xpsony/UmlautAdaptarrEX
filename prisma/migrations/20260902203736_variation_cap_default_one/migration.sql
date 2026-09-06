-- `maxTitleVariations` column default 3 -> 1, existing rows included.
--
-- The cap counts the GENERATED German variations only; the literal query and
-- the canonical title are appended on top and are never dropped. One alias
-- covers the common case (an indexer listing the release only under its German
-- name) at a third of the outbound cost, so 1 is where an installation should
-- start. The Zod schema (src/schemas/settings.ts) now also accepts 0, which
-- means "no German variations" and still searches those two.
--
-- The UPDATE at the end deliberately rewrites existing rows, which the usual
-- new-vs-existing split would not do. The column is unreleased: it arrived in
-- 20260827130824_sync_intervals with DEFAULT 3 and 1.4.0 has not shipped, so
-- no operator ever chose 3 - 1.3.0 had a hard-coded 10 and no setting at all.
-- Without the UPDATE an upgrade would land on 3 and a fresh install on 1,
-- purely because of the order the two migrations run in. Anyone running a
-- 1.4.0 dev build who set the value by hand re-sets it after the update, the
-- same caveat 20260827140215_force_recommended_defaults carries.

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

-- Existing rows too, see the header. On a fresh database the table is empty
-- and this is a no-op; the Setting row the setup wizard creates later picks up
-- the new column default anyway.
UPDATE "Setting"
SET "maxTitleVariations" = 1;
