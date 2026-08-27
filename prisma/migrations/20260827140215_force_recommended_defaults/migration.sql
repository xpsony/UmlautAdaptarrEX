-- Force the recommended defaults onto EXISTING installations.
--
-- `20260827083510_rename_options` and `20260827130824_sync_intervals` each
-- pinned their new column to the old behaviour, so that an upgrade could not
-- change what an existing install delivers to the *Arr. Decision 2026-08-27:
-- the recommended values ship for everyone instead. They are recommended
-- because they are better, and an operator who wants the old output switches
-- the flag off in Settings - the switches exist for exactly that. Both
-- migrations above are already applied and immutable, so the flip needs a
-- migration of its own.
--
--   renameStripSpecialChars  Settings -> Renaming. Drops `: ? * " < > | / \`
--                            from the inserted title; scene releases never
--                            carry them and the *Arr parse the result more
--                            reliably.
--   renameAttachExternalIds  Settings -> Renaming. Adds tvdbid / tmdbid /
--                            imdb as newznab attributes. Purely additive; an
--                            id the indexer already sent is never overwritten.
--   movieVariationSearch     Settings -> Suche. Searches films with their
--                            German title variations, the way series have
--                            always been searched. This is the one that costs
--                            outbound requests - bounded by
--                            `maxTitleVariations` (default 3), so worst case
--                            N+2 indexer requests per film search.
--
-- This deliberately also re-enables a flag an operator had switched off by
-- hand: nothing records WHY a column is false, so "kept the old default" and
-- "turned it off on purpose" are indistinguishable here. The upgrade notes in
-- the changelog say so.
--
-- On a fresh database the table is empty and this is a no-op - the Setting row
-- the setup wizard creates later picks up the `true` column defaults anyway.
UPDATE "Setting"
SET "renameStripSpecialChars" = true,
    "renameAttachExternalIds" = true,
    "movieVariationSearch" = true;
