import { expect, test } from "@playwright/test";
import { deleteAllInstances } from "./_setup/api-helpers";

// The connection-test endpoint phones the configured Sonarr/Radarr
// host, so we mock just that one call. Everything else (POST, GET,
// PATCH, DELETE) goes against real Fastify + SQLite.
test.describe("instances dialog", () => {
  test.afterEach(async ({ page }) => {
    await deleteAllInstances(page);
  });

  test("opens add dialog, swaps default provider order on type change", async ({
    page,
  }) => {
    await page.goto("/instances");
    await expect(
      page.getByRole("heading", { name: "Arr instances" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Add instance" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("heading", { name: "Add a new instance" }),
    ).toBeVisible();
    await expect(dialog.getByLabel("Type")).toBeVisible();

    // Sonarr (default) needs a provider order; Lidarr does not. Switching
    // to Lidarr should hide the dnd field.
    await expect(
      dialog.getByText("Provider order", { exact: false }),
    ).toBeVisible();

    await dialog.getByLabel("Type").click();
    await page.getByRole("option", { name: /lidarr/i }).click();

    await expect(
      dialog.getByText("Provider order", { exact: false }),
    ).toHaveCount(0);

    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).not.toBeVisible();
  });

  test("test connection: shows toast on mocked success", async ({ page }) => {
    await page.route("**/api/admin/instances/test", async (route) => {
      const body = (await route.request().postDataJSON()) as {
        type: string;
      };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, version: `4.0.0-${body.type}` }),
      });
    });

    await page.goto("/instances");
    await page.getByRole("button", { name: "Add instance" }).click();
    const dialog = page.getByRole("dialog");

    await dialog.getByLabel("Name").fill("Sonarr 4K");
    await dialog.getByLabel("Host").fill("http://sonarr:8989");
    await dialog.getByLabel("API key").fill("mocked-api-key-123456");
    await dialog.getByRole("button", { name: "Test connection" }).click();

    await expect(
      page.getByText(/Connection OK.*4\.0\.0-sonarr/i),
    ).toBeVisible();
  });

  test("test connection: surfaces server-side error message", async ({
    page,
  }) => {
    await page.route("**/api/admin/instances/test", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "ECONNREFUSED" }),
      });
    });

    await page.goto("/instances");
    await page.getByRole("button", { name: "Add instance" }).click();
    const dialog = page.getByRole("dialog");

    await dialog.getByLabel("Name").fill("Broken");
    await dialog.getByLabel("Host").fill("http://nope:8989");
    await dialog.getByLabel("API key").fill("not-a-real-api-key-12345678");
    await dialog.getByRole("button", { name: "Test connection" }).click();

    await expect(page.getByText(/ECONNREFUSED/i)).toBeVisible();
  });

  test("creates an instance against the real backend and shows it in the list", async ({
    page,
  }) => {
    await page.goto("/instances");
    await page.getByRole("button", { name: "Add instance" }).click();
    const dialog = page.getByRole("dialog");

    await dialog.getByLabel("Name").fill("Sonarr Real");
    await dialog.getByLabel("Host").fill("http://sonarr:8989");
    await dialog.getByLabel("API key").fill("real-api-key-123456789");
    await dialog.getByRole("button", { name: "Add instance" }).click();

    await expect(page.getByText("Instance created.")).toBeVisible();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByText("Sonarr Real")).toBeVisible();

    // Reload and confirm persistence - the row survived the round-trip.
    await page.reload();
    await expect(page.getByText("Sonarr Real")).toBeVisible();
  });
});
