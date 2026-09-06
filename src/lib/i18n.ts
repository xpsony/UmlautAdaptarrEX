import { getRequestConfig } from "next-intl/server";
import { cookies, headers } from "next/headers";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  type Locale,
  isSupportedLocale,
} from "./i18n-config";

export {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  SUPPORTED_LOCALES,
  type Locale,
  isSupportedLocale,
} from "./i18n-config";

function pickFromAcceptLanguage(header: string | null): Locale {
  if (!header) return DEFAULT_LOCALE;
  for (const part of header.split(",")) {
    const tag = part.split(";")[0]!.trim().toLowerCase();
    if (tag.startsWith("de")) return "de";
    if (tag.startsWith("sv")) return "sv";
    if (tag.startsWith("fr")) return "fr";
    if (tag.startsWith("en")) return "en";
  }
  return DEFAULT_LOCALE;
}

// Deep-merge so that any key missing from the active locale's bundle falls
// back to the corresponding English string. Only plain objects are merged
// recursively; arrays/primitives in the override replace the base value
// outright (matches next-intl's expected message shape - leaves are always
// strings).
type MessagesObj = { [key: string]: string | MessagesObj };

function deepMerge(base: MessagesObj, override: MessagesObj): MessagesObj {
  const out: MessagesObj = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const baseValue = out[key];
    if (
      typeof value === "object" &&
      value !== null &&
      typeof baseValue === "object" &&
      baseValue !== null
    ) {
      out[key] = deepMerge(baseValue, value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const headerStore = await headers();
  const fromCookie = cookieStore.get(LOCALE_COOKIE)?.value;
  const locale = isSupportedLocale(fromCookie)
    ? fromCookie
    : pickFromAcceptLanguage(headerStore.get("accept-language"));

  const enMessages = (await import("../messages/en.json"))
    .default as MessagesObj;
  if (locale === "en") {
    return { locale, messages: enMessages };
  }
  const localeMessages = (await import(`../messages/${locale}.json`))
    .default as MessagesObj;
  // English is the canonical key set; the active locale overlays its
  // translations on top, so untranslated keys (or whole missing sub-trees)
  // gracefully render as English instead of raw `key.path` placeholders.
  return { locale, messages: deepMerge(enMessages, localeMessages) };
});
