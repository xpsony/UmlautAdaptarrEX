/**
 * Token-level diff between an original and a rewritten release title, used by
 * the rename-history UI to highlight only the changed parts of a title.
 * Framework-free on purpose (unit-tested in tests/unit/title-diff.test.ts).
 */

export interface TitleDiffSegment {
  text: string;
  kind: "same" | "removed" | "added";
}

// Release names are < ~100 tokens; anything beyond this cap is not a release
// name and not worth an O(n·m) DP - fall back to whole-string segments.
const TOKEN_CAP = 500;

/** Split a release name into tokens, keeping separators as their own tokens. */
function tokenize(title: string): string[] {
  return title.split(/([.\-_ ])/).filter((t) => t.length > 0);
}

/**
 * LCS-based token diff. The returned segments concatenate back to the inputs:
 * `same` + `removed` segments (in order) form the original title, `same` +
 * `added` segments form the rewritten title.
 */
export function diffTitleTokens(original: string, rewritten: string): TitleDiffSegment[] {
  if (original === rewritten) {
    return original.length > 0 ? [{ text: original, kind: "same" }] : [];
  }
  const a = tokenize(original);
  const b = tokenize(rewritten);
  if (a.length > TOKEN_CAP || b.length > TOKEN_CAP) {
    const fallback: TitleDiffSegment[] = [];
    if (original.length > 0) fallback.push({ text: original, kind: "removed" });
    if (rewritten.length > 0) fallback.push({ text: rewritten, kind: "added" });
    return fallback;
  }

  // dp[i][j] = LCS length of a[i..] vs b[j..]
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }

  const segments: TitleDiffSegment[] = [];
  const push = (text: string, kind: TitleDiffSegment["kind"]): void => {
    const last = segments[segments.length - 1];
    if (last && last.kind === kind) last.text += text;
    else segments.push({ text, kind });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push(a[i]!, "same");
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      push(a[i]!, "removed");
      i++;
    } else {
      push(b[j]!, "added");
      j++;
    }
  }
  while (i < n) push(a[i++]!, "removed");
  while (j < m) push(b[j++]!, "added");
  return segments;
}
