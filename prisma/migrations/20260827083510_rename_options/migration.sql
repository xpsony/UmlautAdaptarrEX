-- AlterTable
ALTER TABLE "SearchItem" ADD COLUMN "imdbId" TEXT;

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
    "userAgent" TEXT NOT NULL DEFAULT 'UmlautAdaptarrEX/2.0',
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
INSERT INTO "new_Setting" ("appApiKey", "blockPrivateInstanceHosts", "cacheDurationMinutes", "csrfSecret", "historyRetentionDays", "id", "indexerRateLimitMs", "indexerTimeoutSeconds", "logRetentionDays", "operationMode", "pausedUntil", "prowlarrApiKey", "prowlarrHost", "proxyPassword", "proxyPort", "proxyUsername", "setupComplete", "titleApiHost", "tmdbApiKey", "tvdbApiKey", "tvdbPin", "userAgent") SELECT "appApiKey", "blockPrivateInstanceHosts", "cacheDurationMinutes", "csrfSecret", "historyRetentionDays", "id", "indexerRateLimitMs", "indexerTimeoutSeconds", "logRetentionDays", "operationMode", "pausedUntil", "prowlarrApiKey", "prowlarrHost", "proxyPassword", "proxyPort", "proxyUsername", "setupComplete", "titleApiHost", "tmdbApiKey", "tvdbApiKey", "tvdbPin", "userAgent" FROM "Setting";
DROP TABLE "Setting";
ALTER TABLE "new_Setting" RENAME TO "Setting";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Backfill for EXISTING installations only.
--
-- `renameStripSpecialChars` and `renameAttachExternalIds` default to `true`
-- because that is the better behaviour for a fresh install: scene releases
-- never carry `:` and Sonarr/Radarr bind a release far more reliably from a
-- newznab id attribute than from a parsed title. Both do however change the
-- bytes we hand back to the *Arr, so an existing install must not be flipped
-- silently — it keeps today's output until the operator opts in.
--
-- The RedefineTables block above copies only rows that were already present,
-- so any row visible here belongs to a pre-existing install. On a fresh
-- database the table is empty, this UPDATE is a no-op, and the Setting row
-- created later by the setup wizard picks up the `true` defaults.
UPDATE "Setting"
SET "renameStripSpecialChars" = false,
    "renameAttachExternalIds" = false;
