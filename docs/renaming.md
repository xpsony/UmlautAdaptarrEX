# Release renaming

When an \*arr issues a search through UmlautAdaptarrEX, the indexer's XML response is parsed, every `<item>`
runs through the rename pipeline, and the `<title>` node is rewritten in place before the response goes back
to Sonarr/Radarr/Lidarr/Readarr.

The goal: a release like `Drei.Haselnuesse.fuer.Aschenbroedel.1973.German.1080p.BluRay.x264-EXAMPLE` is
rewritten so the \*arr can match it against its expected title (`Drei Haselnüsse für Aschenbrödel 1973
German 1080p BluRay x264-EXAMPLE`). Without that rewrite the import-matching fails because the \*arr looks
up the exact expected title.

## Pipeline

[src/domain/xml/rewrite.ts:98](../src/domain/xml/rewrite.ts#L98) (`rewriteIndexerXml`):

1. **Parse the XML** with `fast-xml-parser` ([src/domain/xml/parse.ts](../src/domain/xml/parse.ts)).
   The `<channel>`/`<item>` structure is preserved and any `<title>` shape (plain, CDATA, `#text` plus
   attributes) survives the round-trip because `writeTitle` keeps the original wire form.
2. **For each item:** read the original title and clean a comparison form for the cache lookup
   (`removeAccentButKeepDiacritics` then `replaceSeparatorsWithSpace`).
3. **Determine media type from the category**
   ([src/domain/matching/category.ts](../src/domain/matching/category.ts)). Recognises Newznab IDs
   (`5xxx → tv`, `2xxx → movie`, `3xxx → audio`, `7xxx`/`3030` → `book`) and German plain-text categories
   (`Filme`, `Serien`, `Bücher`, `Hörbuch`).
4. **Resolve a SearchItem.** Either passed in directly (`options.searchItem`, set by the resolving
   `tvsearch`/`movie`/`music`/`book` endpoint) or looked up via `options.lookup(mediaType, cleanTitle)`
   against the in-memory index in `AppState`. Items without a matching SearchItem are skipped.
5. **Run the rename**, dispatched by media type:
   - `tv` / `movie` → [`renameForMoviesAndTv`](../src/domain/matching/rename.ts)
   - `audio` / `book` → [`renameForBooksAndAudio`](../src/domain/matching/books-audio.ts) (requires
     `expectedAuthor`, otherwise skipped).
6. **Replace `<title>`**, but only when `rewritten !== originalTitle`. The `onRename` callback fires so the
   caller can persist the event.

## TV / movies - `renameForMoviesAndTv`

[src/domain/matching/rename.ts:18](../src/domain/matching/rename.ts#L18). Assumes the original title _starts
with_ one of the `titleMatchVariations`, which is true for the typical scene-style release where the work
sits in front of every quality tag.

```
Original   : Drei.Haselnuesse.fuer.Aschenbroedel.1973.German.1080p.BluRay.x264-EXAMPLE
Variation  : Drei Haselnüsse für Aschenbrödel        (one of many, generated under src/domain/variations/)
Expected   : Drei Haselnüsse für Aschenbrödel
Result     : Drei Haselnüsse für Aschenbrödel.1973.German.1080p.BluRay.x264-EXAMPLE
```

Steps:

1. **Sort variations** longest-normalized-first so a more specific variation wins over a shorter ambiguous
   one.
2. **Skip the variation that equals `expectedTitle`.** If the release already carries the expected title,
   nothing needs to happen.
3. **Prefix match** on `normalizeForComparison(original).startsWith(normalizeForComparison(variation))`.
   Variations whose normalized form is empty are skipped - otherwise an accent-only variation like `é` would
   normalize to `""` and match every release
   ([commit b67d912](../../../commit/b67d912)).
4. **Detect the separator** from the original (first occurrence of `.`, `_`, `␣`; falls back to `␣`)
   ([src/domain/matching/separator.ts](../src/domain/matching/separator.ts)).
5. **Compute the end index** by walking the original character by character with `normalizedCharContribution`
   ([src/domain/normalization/comparison.ts:42](../src/domain/normalization/comparison.ts#L42)). This matters
   because:
   - `ß` → `"ss"` (1 source char contributes 2 to the normalized form)
   - `é` → `"e"` (1 source char contributes 1, even when no active plugin lists the accent as a word char)
   - Separators (`.`, `_`, `␣`, `-`) contribute 0.

   Counting raw word chars instead would mis-slice the suffix: `Strasse` against `Straße.Test.S01E01` would
   return `.est.S01E01` because `ß` was undercounted. The walk reads verbose on purpose, the _why_ is in the
   inline comment.

6. **Ambiguity gate** - when `expectedTitle` _starts with_ `variation` (e.g. `Sigrid` ⊂
   `Sigrid - Beyond the Realm's End`), only rewrite if a strong release marker follows immediately:
   `SxxEyy` for TV, or a four-digit year (`19xx`/`20xx`) for movies. Otherwise the function returns `null`
   with `reason: "ambiguous-prefix"` because the prefix could belong to a different work that happens to
   share it.
7. **Assemble the output:** the expected title with spaces replaced by the detected separator, then the
   suffix that follows the matched span.

## Books / audio - `renameForBooksAndAudio`

[src/domain/matching/books-audio.ts:93](../src/domain/matching/books-audio.ts#L93). These categories don't
follow a reliable "work in front" pattern (different sites interleave quality tags before and after the
title, some use `Author - Title - Genre - Format`). So instead of a prefix match, the algorithm locates the
author span and the title span independently in the original.

```
Original    : Sebastian Fitzek - Das Geschenk - Thriller (Hörbuch).MP3-EXAMPLE
Variations  : ["Sebastian Fitzek", "S. Fitzek", "Fitzek"], ["Das Geschenk", "Geschenk"]
Result      : Sebastian Fitzek - Das Geschenk-[Thriller (Hörbuch).MP3-EXAMPLE]
```

Steps:

1. **`findBestMatch` for the author** and **for the title**, independently. "Best" = longest _normalized_
   match length; ties go to the earliest start. That way a more specific variation wins, and a coincidental
   short hit late in the release name doesn't push the end index into the quality tags.
2. **If both match:** end position = `max(author.end, title.end)`. If a single delimiter (`␣`, `-`, `_`, `.`)
   sits right after that index, advance one more character.
3. **Trim the suffix** (everything past the end position) and strip any leading delimiters.
4. **Emit** `${expectedAuthor} - ${expectedTitle}`, optionally appending `-[<suffix>]` if the suffix is at
   least 3 characters long (shorter remainders are usually noise).

If either the author or the title can't be found in the original, the function returns `null` and the item
is left untouched.

## Persistence: `RenameHistory`

Every successful rewrite is written to the `RenameHistory` table
([prisma/schema.prisma:193](../prisma/schema.prisma#L193)) through the `onRename` callback wired in
[src/server/routes/legacy/search.ts:152-165](../src/server/routes/legacy/search.ts#L152-L165):

| Column                | Content                                                        |
| --------------------- | -------------------------------------------------------------- |
| `originalTitle`       | XML title before the rewrite.                                  |
| `rewrittenTitle`      | What the \*arr ends up seeing.                                 |
| `mediaType`           | `tv` / `movie` / `audio` / `book`.                             |
| `matchedSearchItemId` | Optional, set when the rewrite was tied to a known SearchItem. |
| `createdAt`           | DEFAULT now().                                                 |

Inserts are fire-and-forget (`void prisma.renameHistory.create({...}).catch(debug)`): a DB error never aborts
the request and never hides the rewritten title. The Web UI surfaces the table at
[/rename-history](<../src/app/(admin)/rename-history>) via `GET /api/admin/rename-history` (see
[docs/api.md](api.md)).

## Tests

Pure-domain tests live under [tests/unit/](../tests/unit/):

- `matching-tv.test.ts` - edge cases for `renameForMoviesAndTv` (umlauts, ß expansion, ambiguity gate, empty
  variations).
- `matching-books.test.ts` - `renameForBooksAndAudio` (author/title spans, suffix handling).
- `xml-rewrite.test.ts` - wire preservation (CDATA stays CDATA, attribute order, items without a SearchItem
  pass through untouched).

Run via `pnpm test`. If you change either algorithm, the unit suite is the cheapest regression net - both
functions are framework-free and don't need the DB.

## Known pitfalls

- **`titleMatchVariations` is the source of truth.** Generators live in
  [src/domain/variations/](../src/domain/variations/) (`generate.ts`, `tv-movie.ts`, `books-audio.ts`). When
  a specific release fails to rename, the most common cause is that an expected spelling isn't in the
  variations list. Check there before touching the algorithms.
- **Accent-only variations.** A variation that normalizes to the empty string would otherwise match every
  release. Both algorithms `continue` past those explicitly.
- **The ambiguity gate is intentionally strict.** It accepts a false-negative rewrite to avoid a
  false-positive: a wrong rewrite ends up in the \*arr's library import on the wrong series, which is much
  more painful to clean up.
- **Books/audio require `expectedAuthor`.** When a provider doesn't return an author, the item is left
  untouched. The skip is explicit at
  [src/domain/xml/rewrite.ts:138](../src/domain/xml/rewrite.ts#L138).
