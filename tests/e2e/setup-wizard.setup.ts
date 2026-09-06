import path from "node:path";
import { existsSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { E2E_PATHS } from "../../playwright.config";
import {
  completeSetupWizard,
  DEFAULT_WIZARD_CREDS,
  setupStepTitle,
} from "./_setup/wizard";

// Walks the wizard from a fresh DB, asserts the step transitions and the
// recommended/warning copy on the operation-mode picker, and saves the
// resulting cookies as the storageState used by every authenticated spec.
test("setup wizard: redirect, mode picker copy, end-to-end completion", async ({
  page,
  context,
}) => {
  await test.step("root path redirects into the wizard on a fresh DB", async () => {
    await page.goto("/dashboard");
    await page.waitForURL("**/setup", { timeout: 15_000 });
    await expect(setupStepTitle(page, "Admin account")).toBeVisible();
  });

  await test.step("admin step validates required fields", async () => {
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(setupStepTitle(page, "Operation mode")).not.toBeVisible();

    await page.getByLabel("Username").fill(DEFAULT_WIZARD_CREDS.username);
    await page
      .locator('input[id="password"]')
      .fill(DEFAULT_WIZARD_CREDS.password);
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(setupStepTitle(page, "Operation mode")).toBeVisible();
  });

  await test.step("operation-mode picker exposes all three options + recommended/warning copy", async () => {
    await expect(page.getByText("Recommended", { exact: true })).toBeVisible();
    await expect(page.getByText(/Not recommended/i)).toBeVisible();

    const proxy = page.getByRole("radio", { name: /Proxy mode/i });
    const legacy = page.getByRole("radio", { name: /Index API \(legacy\)/i });
    // The "Both" radio's accessible name concatenates label + description
    // ("Both Both the proxy …"), so match the unique two-word prefix.
    const both = page.getByRole("radio", { name: /^Both Both/i });
    await expect(proxy).toBeVisible();
    await expect(legacy).toBeVisible();
    await expect(both).toBeVisible();

    await legacy.click();
    await expect(legacy).toHaveAttribute("data-state", "checked");
    await proxy.click();
    await expect(proxy).toHaveAttribute("data-state", "checked");

    await page.getByRole("button", { name: "Continue" }).click();
  });

  await test.step("plugins step renders and is skippable", async () => {
    await expect(setupStepTitle(page, "Select plugins")).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();
  });

  await test.step("prowlarr-connect step skips cleanly without a live Prowlarr", async () => {
    await expect(setupStepTitle(page, "Connect Prowlarr")).toBeVisible();
    await page.getByRole("button", { name: "Skip Prowlarr setup" }).click();
  });

  await test.step("proxy step accepts credentials and finalizes setup", async () => {
    await expect(setupStepTitle(page, "HTTP-Proxy credentials")).toBeVisible();

    await page
      .getByLabel("Proxy username")
      .fill(DEFAULT_WIZARD_CREDS.proxyUsername);
    await page
      .locator('input[id="proxyPassword"]')
      .fill(DEFAULT_WIZARD_CREDS.proxyPassword);

    await page.getByRole("button", { name: "Complete setup" }).click();
    await page.waitForURL("**/dashboard", { timeout: 30_000 });
    await expect(
      page.getByRole("heading", { name: "Dashboard" }),
    ).toBeVisible();
  });

  await test.step("setup-status flips to complete + storageState is saved", async () => {
    const status = await page.request.get("/api/auth/setup-status");
    expect(status.ok()).toBe(true);
    const body = (await status.json()) as { setupComplete: boolean };
    expect(body.setupComplete).toBe(true);

    const storagePath = E2E_PATHS.storageStatePath;
    await context.storageState({ path: storagePath });
    expect(existsSync(storagePath)).toBe(true);
    expect(path.basename(storagePath)).toBe("admin.json");
  });
});

// Smoke test for the second setup branch - purely UI navigation, no DB
// mutation. Reuses the now-completed-setup DB by virtue of running after
// the main flow above; we assert the gate redirects /setup back to the
// dashboard once setupComplete = true.
test("setup-complete flag redirects /setup to /dashboard", async ({ page }) => {
  await page.goto("/setup");
  await page.waitForURL("**/dashboard", { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
});

// Re-asserts that completeSetupWizard() helper signature stays compatible
// with the imported wizard helpers. Pure type-level check.
void completeSetupWizard;
