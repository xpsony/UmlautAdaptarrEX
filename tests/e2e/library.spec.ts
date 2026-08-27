import { expect, test } from "@playwright/test";
import { authedRequest } from "./_setup/api-helpers";

// Hits real Fastify + SQLite (no mocked routes). The e2e DB is only ever
// populated by a real Sonarr/Radarr/etc. sync, which this suite cannot
// trigger, so `total` is almost always 0 here - the override-flow test
// guards on that and skips itself when there is nothing to click on.
interface SearchItemRow {
  mediaType: string;
  externalId: string;
  expectedTitle: string;
  override: string | null;
}

interface SearchItemsResponse {
  items: SearchItemRow[];
  total: number;
}

test.describe("library page", () => {
  test("renders the heading and either the table or the empty state", async ({ page }) => {
    await page.goto("/library");
    await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();

    // Whichever the seeded DB has, HistoryPage renders exactly one of the two.
    await expect(page.getByRole("table").or(page.getByText("No titles"))).toBeVisible();
  });

  test("typing into the search field re-queries search-items with the search param", async ({
    page,
  }) => {
    await page.goto("/library");
    await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();

    const searchInput = page.getByPlaceholder("Search titles…");
    await expect(searchInput).toBeVisible();

    const debouncedRequest = page.waitForRequest(
      (req) => req.url().includes("/api/admin/search-items") && req.url().includes("search=dark"),
    );
    await searchInput.fill("dark");
    await debouncedRequest;
  });

  test("override flow: setting and removing a manual German title updates the badge", async ({
    page,
  }) => {
    // Look at a small batch directly through the API to decide whether the
    // override flow is even exercisable, and to avoid clobbering a row that
    // already carries an override.
    const listRes = await page.request.get("/api/admin/search-items?take=25");
    expect(listRes.ok()).toBe(true);
    const { items, total } = (await listRes.json()) as SearchItemsResponse;

    test.skip(total === 0, "e2e DB has no SearchItem rows - nothing to override");

    const target = items.find((i) => i.override === null);
    if (!target) {
      test.skip(
        true,
        "every fetched row already carries an override - skipping to avoid clobbering existing data",
      );
      return;
    }

    const OVERRIDE_VALUE = "E2E Override Title";
    let overrideSet = false;

    try {
      await page.goto("/library");
      await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();

      const row = page.getByRole("button", { name: target.expectedTitle, exact: true }).first();
      await expect(row).toBeVisible();
      await row.click();

      const sheet = page.getByRole("dialog");
      await expect(sheet).toBeVisible();
      const overrideInput = sheet.getByLabel("German title (override)");
      await overrideInput.fill(OVERRIDE_VALUE);
      await sheet.getByRole("button", { name: "Save override" }).click();

      await expect(page.getByText("Override saved - variations recomputed.")).toBeVisible();
      await expect(sheet).not.toBeVisible();
      overrideSet = true;

      const rowAfterSave = page
        .getByRole("button", { name: target.expectedTitle, exact: true })
        .first();
      await expect(rowAfterSave.getByText("Override")).toBeVisible();

      await rowAfterSave.click();
      const reopenedSheet = page.getByRole("dialog");
      await expect(reopenedSheet).toBeVisible();
      await expect(reopenedSheet.getByLabel("German title (override)")).toHaveValue(OVERRIDE_VALUE);
      await reopenedSheet.getByRole("button", { name: "Remove override" }).click();

      await expect(page.getByText("Override removed.")).toBeVisible();
      await expect(reopenedSheet).not.toBeVisible();
      overrideSet = false;

      const rowAfterRemove = page
        .getByRole("button", { name: target.expectedTitle, exact: true })
        .first();
      await expect(rowAfterRemove.getByText("Override")).toHaveCount(0);
    } finally {
      // Idempotent cleanup so reruns never trip over a leftover override.
      if (overrideSet) {
        await authedRequest(
          page.request,
          page.context(),
          `/api/admin/title-overrides/${target.mediaType}/${encodeURIComponent(target.externalId)}`,
          { method: "DELETE" },
        );
      }
    }
  });
});
