-- Per-instance switch for Readarr/Listenarr: also search the spelling
-- variations of the title without the author. Defaults to false for every
-- existing instance, so nothing changes on upgrade.

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ArrInstance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "providerOrder" TEXT,
    "enableYearMatching" BOOLEAN NOT NULL DEFAULT true,
    "yearMatchingTolerance" INTEGER NOT NULL DEFAULT 1,
    "searchWithoutAuthor" BOOLEAN NOT NULL DEFAULT false,
    "lastSyncAt" DATETIME,
    "lastFullSyncAt" DATETIME,
    "lastSyncError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_ArrInstance" ("apiKey", "createdAt", "enableYearMatching", "enabled", "host", "id", "lastFullSyncAt", "lastSyncAt", "lastSyncError", "name", "providerOrder", "type", "updatedAt", "yearMatchingTolerance") SELECT "apiKey", "createdAt", "enableYearMatching", "enabled", "host", "id", "lastFullSyncAt", "lastSyncAt", "lastSyncError", "name", "providerOrder", "type", "updatedAt", "yearMatchingTolerance" FROM "ArrInstance";
DROP TABLE "ArrInstance";
ALTER TABLE "new_ArrInstance" RENAME TO "ArrInstance";
CREATE INDEX "ArrInstance_enabled_idx" ON "ArrInstance"("enabled");
CREATE UNIQUE INDEX "ArrInstance_type_name_key" ON "ArrInstance"("type", "name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

