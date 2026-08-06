-- CreateTable
CREATE TABLE "TitleOverride" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mediaType" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "germanTitle" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "TitleOverride_mediaType_externalId_key" ON "TitleOverride"("mediaType", "externalId");
