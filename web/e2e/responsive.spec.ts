import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test("landing has no horizontal scroll and a working menu", async ({ page }) => {
  await page.goto("./");
  await noHorizontalScroll(page);
  const menu = page.getByRole("button", { name: "Open menu" });
  if (await menu.isVisible()) {
    await menu.click();
    await expect(page.locator("#nav-links")).toBeVisible();
  }
});

test("console has no horizontal scroll and a sidebar toggle", async ({ page }) => {
  for (const route of ["overview", "models", "nodes", "playground", "access", "audit"]) {
    await page.goto(`./console.html?demo#/${route}`);
    await expect(page.locator("#view-title")).not.toBeEmpty();
    await noHorizontalScroll(page);
  }
  const toggle = page.getByRole("button", { name: "Open navigation" });
  if (await toggle.isVisible()) {
    await toggle.click();
    await expect(page.locator("#sidebar")).toHaveClass(/is-open/);
  }
});
