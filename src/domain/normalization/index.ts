export * from "./accents";
export * from "./clean";
export * from "./comparison";

import {escapeRegex} from "../matching/separator";
import {getActiveLanguagePack, type LanguagePack} from "../plugins";
import {removeAccentButKeepDiacritics} from "./accents";

/**
 * Strip a leading article (`The|Der|Die|Das|...`) — case-insensitive — using
 * the active language pack's article list. Falls back to a sensible default
 * if no plugin contributes articles, so utility callers (e.g. Lidarr title
 * normalization) still strip `The/An/A`.
 */
export function stripLeadingArticle(
    input: string,
    pack: LanguagePack = getActiveLanguagePack(),
): string {
    // Reuse the pack's precompiled (case-insensitive) article regex when the
    // pack contributes articles; only build a regex for the default fallback
    // list when the pack has none.
    const re =
        pack.articleRegex ??
        new RegExp(`^(${["the", "an", "a"].map(escapeRegex).join("|")})\\s+`, "i");
    return input.replace(re, "");
}

export function getLidarrTitleForExternalId(
    title: string,
    pack: LanguagePack = getActiveLanguagePack(),
): string {
    return removeAccentButKeepDiacritics(
        stripLeadingArticle(title, pack),
        pack,
    ).trim();
}

export function getReadarrTitleForExternalId(
    title: string,
    pack: LanguagePack = getActiveLanguagePack(),
): string {
    // Honor the active language pack's article list (German/French/...), like
    // the sibling `getLidarrTitleForExternalId`, instead of stripping only the
    // English "the".
    const noArticle = stripLeadingArticle(title, pack);
    const sepReplaced = noArticle.replace(/[.\-:]/g, " ").replace(/\s+/g, " ");
    return removeAccentButKeepDiacritics(sepReplaced, pack).trim();
}
