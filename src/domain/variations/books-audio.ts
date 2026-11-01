import {escapeRegex} from "../matching/separator";
import {removeExtraWhitespaces} from "../normalization/clean";
import {getActiveLanguagePack, type LanguagePack} from "../plugins";
import {generateVariations, type MediaType} from "./generate";

export interface BooksAudioVariationInput {
    expectedTitle: string;
    expectedAuthor: string;
    mediaType: Extract<MediaType, "audio" | "book">;
}

export interface BooksAudioVariationOutput {
    titleSearchVariations: string[];
    titleMatchVariations: string[];
    authorMatchVariations: string[];
}

export function generateForBooksAndAudio(
    input: BooksAudioVariationInput,
    pack: LanguagePack = getActiveLanguagePack(),
): BooksAudioVariationOutput {
    const {expectedTitle, expectedAuthor, mediaType} = input;

    // Strip the artist out of the album title case-insensitively, so "GROLLT!"
    // by "Grollt!" is treated like an exact self-titled album. Otherwise the
    // bare artist name ends up in titleMatchVariations and then matches every
    // release of that artist.
    // Only as a whole word: "Vex" must not be cut out of "VEXILLUM" (leaving
    // "ILLUM") or "Lark" out of "Larkspur". Letters/digits as the boundary
    // instead of \b, so names that start or end in punctuation (Nord/Stil,
    // Grollt!, +71) still match.
    // No match leaves the title untouched, so the replace covers both cases -
    // generateVariations normalizes the whitespace again either way.
    const authorPattern = new RegExp(
        `(?<![\\p{L}\\p{N}])${escapeRegex(expectedAuthor)}(?![\\p{L}\\p{N}])`,
        "iu",
    );
    const titleMatch = generateVariations(
        removeExtraWhitespaces(expectedTitle.replace(authorPattern, "")),
        mediaType,
        pack,
    );

    const titleSearch = generateVariations(
        `${expectedAuthor} ${expectedTitle}`,
        mediaType,
        pack,
    );
    let authorMatch = generateVariations(expectedAuthor, mediaType, pack);

    if (mediaType === "book" && expectedAuthor.includes(" ")) {
        const parts = expectedAuthor.split(/\s+/).filter(Boolean);
        const lastName = parts[parts.length - 1]!;
        const firstNames = parts.slice(0, -1).join(" ");
        const alt = `${lastName}, ${firstNames}`;
        authorMatch = [...authorMatch, ...generateVariations(alt, mediaType, pack)];
    }

    return {
        titleSearchVariations: titleSearch,
        titleMatchVariations: titleMatch,
        authorMatchVariations: Array.from(new Set(authorMatch)),
    };
}
