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
    "blockPrivateInstanceHosts" BOOLEAN NOT NULL DEFAULT false
);
INSERT INTO "new_Setting" ("appApiKey", "blockPrivateInstanceHosts", "cacheDurationMinutes", "csrfSecret", "id", "indexerRateLimitMs", "indexerTimeoutSeconds", "logRetentionDays", "operationMode", "pausedUntil", "prowlarrApiKey", "prowlarrHost", "proxyPassword", "proxyPort", "proxyUsername", "setupComplete", "titleApiHost", "tmdbApiKey", "tvdbApiKey", "tvdbPin", "userAgent") SELECT "appApiKey", "blockPrivateInstanceHosts", "cacheDurationMinutes", "csrfSecret", "id", "indexerRateLimitMs", "indexerTimeoutSeconds", "logRetentionDays", "operationMode", "pausedUntil", "prowlarrApiKey", "prowlarrHost", "proxyPassword", "proxyPort", "proxyUsername", "setupComplete", "titleApiHost", "tmdbApiKey", "tvdbApiKey", "tvdbPin", "userAgent" FROM "Setting";
DROP TABLE "Setting";
ALTER TABLE "new_Setting" RENAME TO "Setting";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
