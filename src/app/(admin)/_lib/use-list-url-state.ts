"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useDebouncedValue } from "@/app/_lib/use-debounced-value";
import { PAGE_SIZES } from "@/components/ui/table-pagination";

export type SortOrder = "asc" | "desc";

export interface SortState {
  key: string;
  order: SortOrder;
}

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 50;
const VALID_PAGE_SIZES = new Set<number>(PAGE_SIZES);

function parsePositiveInt(raw: string | null, fallback: number): number {
  if (raw === null) return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/** A value that clears the param when falsy/empty, or is written to the URL otherwise. */
export type PatchValue = string | number | boolean | undefined;

export interface UseListUrlStateResult {
  /** Free-text search term as committed to the URL (`q`), defaulting to `""`. */
  q: string;
  /**
   * Controlled value for the search input - updates on every keystroke so
   * typing feels instant. Use this (not `q`) as the `<Input value>`.
   */
  searchInput: string;
  /** `onChange` handler for the search input; pass the raw event value. */
  setSearchInput: (next: string) => void;
  /**
   * Debounced, trimmed echo of `searchInput` - this is what eventually lands
   * in `q` (and resets `page`) once typing settles. Use this directly in
   * fetch params/query keys instead of `q` so requests don't lag an extra
   * render behind the debounce commit.
   */
  debouncedSearch: string;
  /** 1-based page number (`page`), sanitized to `1` for anything non-positive/non-numeric. */
  page: number;
  /** Rows per page (`size`), sanitized to the default for any value outside the fixed size set. */
  pageSize: number;
  /** Current sort key/order (`sort`/`order`), sanitized against `validSortKeys` when provided. */
  sort: SortState;
  /**
   * Reads a page-specific string filter param, defaulting to `fallback` when
   * absent OR (if `validValues` is given) not one of them - a bogus deep-link
   * value falls back cleanly instead of e.g. rendering a blank Select.
   */
  getParam: (key: string, fallback: string, validValues?: readonly string[]) => string;
  /** Reads a page-specific boolean flag param (present as `"1"` in the URL). */
  getFlag: (key: string) => boolean;
  /** Sets `q`; always resets `page` (a new search term invalidates the current page). */
  setQuery: (q: string) => void;
  /** Sets `page` directly; does NOT reset itself (that would be a no-op) or other params. */
  setPage: (page: number) => void;
  /** Sets `size`; always resets `page` (mirrors the previous in-memory behavior). */
  setPageSize: (size: number) => void;
  /** Toggles sort order on repeat clicks of the same column, else starts that column at `asc`; resets `page`. */
  toggleSort: (key: string) => void;
  /**
   * Merges arbitrary page-specific filter params (e.g. `status`, `instanceId`,
   * `mediaType`, `missing`) into the URL and resets `page`. A value of
   * `undefined`, `""`, or `false` removes that param (clean URL for the
   * default/unset state); `true` is written as `"1"`.
   */
  setFilters: (updates: Record<string, PatchValue>) => void;
}

export interface UseListUrlStateOptions {
  /** Sort applied when the URL has no (valid) `sort`/`order` params. */
  defaultSort: SortState;
  /**
   * Whitelist of sort keys this page's route accepts. An unrecognized `sort`
   * value in the URL sanitizes to `defaultSort` client-side - the server
   * would silently fall back too, but this keeps the header's active-column
   * indicator honest. Omit to accept any non-empty `sort` value as-is.
   */
  validSortKeys?: readonly string[];
  /** Debounce delay for `searchInput` → `q`/`debouncedSearch`. Defaults to 300ms. */
  searchDebounceMs?: number;
}

/**
 * Shared URL-state for the admin list pages (sync-runs, request-history,
 * rename-history, library): search, pagination, sort, and page-specific
 * filters all live in the query string instead of component state.
 *
 * Writes go through `router.replace` (never `router.push`), so filter/sort/
 * page changes never spam browser history - this is a deliberate choice:
 * Back should return to whatever page the user came from, not click back
 * through every intermediate filter tweak on this same list. `replace` still
 * composes fine with real navigations elsewhere in the app; Back across an
 * actual page-to-page nav is unaffected.
 *
 * Callers MUST render the component using this hook inside a `<Suspense>`
 * boundary (`useSearchParams` bails out to the nearest one during static
 * rendering) - see `nextjs-use-search-params-suspense`.
 */
export function useListUrlState(options: UseListUrlStateOptions): UseListUrlStateResult {
  const { defaultSort, validSortKeys, searchDebounceMs } = options;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const q = searchParams.get("q") ?? "";
  const page = parsePositiveInt(searchParams.get("page"), DEFAULT_PAGE);
  const rawPageSize = parsePositiveInt(searchParams.get("size"), DEFAULT_PAGE_SIZE);
  const pageSize = VALID_PAGE_SIZES.has(rawPageSize) ? rawPageSize : DEFAULT_PAGE_SIZE;

  const sort = useMemo<SortState>(() => {
    const rawKey = searchParams.get("sort");
    const keyValid = !!rawKey && (!validSortKeys || validSortKeys.includes(rawKey));
    const rawOrder = searchParams.get("order");
    const orderValid = rawOrder === "asc" || rawOrder === "desc";
    if (!keyValid) return defaultSort;
    // A recognized column with no (valid) explicit order starts at "asc"
    // rather than inheriting the default sort's order, which belongs to a
    // different column.
    return { key: rawKey, order: orderValid ? rawOrder : "asc" };
  }, [searchParams, defaultSort, validSortKeys]);

  const getParam = useCallback(
    (key: string, fallback: string, validValues?: readonly string[]) => {
      const raw = searchParams.get(key);
      if (raw === null) return fallback;
      if (validValues && !validValues.includes(raw)) return fallback;
      return raw;
    },
    [searchParams],
  );
  const getFlag = useCallback((key: string) => searchParams.get(key) === "1", [searchParams]);

  // Low-level writer shared by every setter below. Any key present in
  // `updates` is written verbatim (or deleted, for a default/empty/false
  // value); any key ABSENT from `updates` is left alone - except `page`,
  // which is dropped whenever the caller isn't explicitly setting it. That
  // single rule is what implements "changing q/filters/sort resets the page"
  // without every call site having to repeat it.
  const patch = useCallback(
    (updates: Record<string, PatchValue>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === undefined || value === "" || value === false) {
          params.delete(key);
        } else {
          params.set(key, value === true ? "1" : String(value));
        }
      }
      if (!("page" in updates)) {
        params.delete("page");
      }
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const setQuery = useCallback(
    (next: string) => patch({ q: next === "" ? undefined : next }),
    [patch],
  );

  const setPage = useCallback(
    (next: number) => patch({ page: next === DEFAULT_PAGE ? undefined : next }),
    [patch],
  );

  const setPageSize = useCallback(
    (next: number) => patch({ size: next === DEFAULT_PAGE_SIZE ? undefined : next }),
    [patch],
  );

  const toggleSort = useCallback(
    (key: string) => {
      const nextOrder: SortOrder =
        sort.key === key ? (sort.order === "asc" ? "desc" : "asc") : "asc";
      const isDefault = key === defaultSort.key && nextOrder === defaultSort.order;
      patch({ sort: isDefault ? undefined : key, order: isDefault ? undefined : nextOrder });
    },
    [sort, defaultSort, patch],
  );

  // `searchInput` is a local echo of `q` so typing feels instant instead of
  // re-navigating on every keystroke. When `q` changes for a reason OTHER
  // than our own debounced commit below - Back/Forward, a deep link, a
  // filter reset - `searchInput` must catch up. That's done here during
  // render (React's documented "adjusting state when a prop changes"
  // pattern: https://react.dev/learn/you-might-not-need-an-effect), not in a
  // useEffect, since setState-in-effect triggers an avoidable extra
  // render+commit cycle and trips the react-hooks/set-state-in-effect rule.
  const [searchInput, setSearchInput] = useState(q);
  const [syncedQ, setSyncedQ] = useState(q);
  if (q !== syncedQ) {
    setSyncedQ(q);
    // Only overwrite `searchInput` when `q` didn't just come from OUR OWN
    // debounced commit (which trims). Without this guard, committing "james "
    // (trailing space) rewrites `q` to "james", which would then clobber the
    // still-being-typed `searchInput` back to "james" mid-keystroke.
    if (q !== searchInput.trim()) setSearchInput(q);
  }

  const debouncedSearch = useDebouncedValue(searchInput.trim(), searchDebounceMs);
  useEffect(() => {
    // This effect's only job is committing to the URL (a `router.replace`
    // call, not a React setState), so it doesn't fall under the same rule -
    // it's the intended use of an effect: synchronizing React state with an
    // external system (the URL).
    if (debouncedSearch !== q) setQuery(debouncedSearch);
    // Re-run only when the debounced value itself settles; `q`/`setQuery`
    // also change on every commit and would otherwise cause redundant
    // replaces without changing the outcome.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  return {
    q,
    searchInput,
    setSearchInput,
    debouncedSearch,
    page,
    pageSize,
    sort,
    getParam,
    getFlag,
    setQuery,
    setPage,
    setPageSize,
    toggleSort,
    setFilters: patch,
  };
}
