import { expect, test } from "@playwright/test";

// Hits real Fastify; the values come from whatever the setup wizard wrote.
// We intentionally do NOT assert on specific values (those are the API
// tests' job) - only on the navigational shape: tabs, headings, key
// inputs that admins reach for.
test.describe("settings tabs", () => {
  test("renders all six tab triggers and the General tab by default", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

    for (const label of [
      "General",
      "Title providers",
      "Prowlarr",
      "Plugins",
      "Renaming",
      "Advanced",
    ]) {
      await expect(page.getByRole("tab", { name: label })).toBeVisible();
    }

    // General tab hosts the operation-mode picker as its first card.
    await expect(page.getByRole("heading", { name: "Operation mode" })).toBeVisible();
  });

  test("Prowlarr tab shows the connection card with the URL field", async ({ page }) => {
    await page.goto("/settings");
    await page.getByRole("tab", { name: "Prowlarr" }).click();

    await expect(page.getByRole("heading", { name: "Prowlarr connection" })).toBeVisible();
    await expect(page.getByLabel("Prowlarr URL")).toBeVisible();
  });

  test("Plugins tab shows the built-in plugins card", async ({ page }) => {
    await page.goto("/settings");
    await page.getByRole("tab", { name: "Plugins" }).click();

    await expect(page.getByRole("heading", { name: "Built-in plugins" })).toBeVisible();
  });

  test("Plugins tab warns about the per-plugin query cost", async ({ page }) => {
    await page.goto("/settings");
    await page.getByRole("tab", { name: "Plugins" }).click();

    await expect(
      page.getByText(/Only enable a language plugin if you actually consume/),
    ).toBeVisible();
  });

  test("Renaming tab shows every toggle with a worked example", async ({ page }) => {
    await page.goto("/settings");
    await page.getByRole("tab", { name: "Renaming" }).click();

    // All six switches are present and reachable by their label.
    for (const label of [
      "Strip unwelcome characters",
      "Attach external ids",
      "Year check",
      "Ambiguous-prefix check",
      "Preserve release tags",
      "Cut the suffix like the old Umlautadaptarr",
    ]) {
      await expect(page.getByRole("switch", { name: label })).toBeVisible();
    }

    // The examples are the point of this tab: one release name and both
    // outcomes per toggle. Spot-check the two that read most differently.
    await expect(
      page.getByText("Ember.Stahlengel.2019.GERMAN.1080p.BluRay.x264-GRP"),
    ).toBeVisible();
    await expect(
      page.getByText("Ember:.Steel.Angel.2019.GERMAN.1080p.BluRay.x264-GRP"),
    ).toBeVisible();
    await expect(page.getByText("Die.Renko.Jagd.016.GERMAN.DL.1080p")).toBeVisible();
    // A guard that declines renders as "not renamed" rather than a title.
    await expect(page.getByText("not renamed").first()).toBeVisible();

    // Both presets are offered.
    await expect(page.getByRole("button", { name: "Like the old Umlautadaptarr" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Recommended values" })).toBeVisible();
  });

  test("the legacy preset flips the guard switches", async ({ page }) => {
    await page.goto("/settings");
    await page.getByRole("tab", { name: "Renaming" }).click();

    const yearCheck = page.getByRole("switch", { name: "Year check" });
    const legacyCut = page.getByRole("switch", {
      name: "Cut the suffix like the old Umlautadaptarr",
    });

    await page.getByRole("button", { name: "Like the old Umlautadaptarr" }).click();
    await expect(yearCheck).toHaveAttribute("aria-checked", "false");
    await expect(legacyCut).toHaveAttribute("aria-checked", "true");

    await page.getByRole("button", { name: "Recommended values" }).click();
    await expect(yearCheck).toHaveAttribute("aria-checked", "true");
    await expect(legacyCut).toHaveAttribute("aria-checked", "false");
  });

  test("Advanced tab exposes the user-agent input", async ({ page }) => {
    await page.goto("/settings");
    await page.getByRole("tab", { name: "Advanced" }).click();

    await expect(page.getByLabel("User-Agent header")).toBeVisible();
  });
});
