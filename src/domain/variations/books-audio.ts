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

    // Case-insensitive, so "OOMPH!" by "Oomph!" or "KRS-ONE" by "KRS-One" is
    // stripped like an exact self-titled album. Otherwise the bare artist name
    // ends up in titleMatchVariations and matches every release of the artist.
    // Only as a whole word: "Nas" must not be cut out of "NASIR" (leaving "IR")
    // or "Cher" out of "Cherished". Letters/digits as the boundary instead of \b,
    // so names starting or ending in punctuation (AC/DC, Oomph!, +44) still work.
    const authorPattern = new RegExp(
        `(?<![\\p{L}\\p{N}])${escapeRegex(expectedAuthor)}(?![\\p{L}\\p{N}])`,
        "iu",
    );
    let titleMatch: string[];
    if (authorPattern.test(expectedTitle)) {
        const stripped = removeExtraWhitespaces(
            expectedTitle.replace(authorPattern, ""),
        );
        titleMatch = generateVariations(stripped, mediaType, pack);
    } else {
        titleMatch = generateVariations(expectedTitle, mediaType, pack);
    }

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
