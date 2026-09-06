import { expect, test } from "@playwright/test";

// Locale and theme toggles run before any auth, so we wipe storageState
// per file and exercise them on /login (the only public, gated page).
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("locale toggle", () => {
  test("switches the UI to German and persists the cookie", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

    await page.getByRole("button", { name: /Language: English/i }).click();
    await page.getByRole("menuitemradio", { name: /Deutsch/i }).click();

    // The toggle triggers a router.refresh() (no full page navigation); wait
    // for the localized heading instead of relying on a navigation event.
    await expect(page.getByRole("heading", { name: "Anmelden" })).toBeVisible();

    const cookies = await page.context().cookies();
    expect(cookies.find((c) => c.name === "ua-locale")?.value).toBe("de");
  });
});

test.describe("theme toggle", () => {
  test("toggles dark mode by writing the html class", async ({ page }) => {
    await page.goto("/login");

    const html = page.locator("html");
    await expect(html).toBeVisible();

    await page.getByRole("button", { name: /Theme:/i }).click();
    await page.getByRole("menuitemradio", { name: "Dark" }).click();

    await expect(html).toHaveClass(/\bdark\b/);

    await page.getByRole("button", { name: /Theme:/i }).click();
    await page.getByRole("menuitemradio", { name: "Light" }).click();

    await expect(html).not.toHaveClass(/\bdark\b/);
  });
});
