export interface NewznabError {
  code: string | null;
  description: string | null;
}

// An optional BOM, XML declaration and comments, then an <error> root element.
const ERROR_ROOT = /^﻿?\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<error\b([^>]*)>/i;

function attr(attrs: string, name: string): string | null {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(attrs);
  return m ? (m[1] ?? m[2] ?? null) : null;
}

/**
 * The Newznab/Torznab error document, e.g.
 * `<error code="500" description="Request limit reached"/>`, or null when the
 * body is a regular feed. Indexers send these with HTTP 200, so the status
 * alone does not tell a limit hit apart from an empty result.
 */
export function parseNewznabError(xml: string): NewznabError | null {
  const m = ERROR_ROOT.exec(xml);
  if (!m) return null;
  const attrs = m[1] ?? "";
  return { code: attr(attrs, "code"), description: attr(attrs, "description") };
}
