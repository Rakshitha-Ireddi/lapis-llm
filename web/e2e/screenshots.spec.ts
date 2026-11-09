/**
 * Regenerates docs/screenshots/*.png for the README.
 *   npm run build && npm run screenshots
 */
import { test, type Page } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "../../docs/screenshots");
const shot = (page: Page, name: string, fullPage = false) =>
  page.screenshot({ path: `${OUT}/${name}.png`, fullPage, animations: "disabled" });

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1440, height: 900 } });

async function settle(page: Page, ms = 2200) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(ms);
}

test("landing", async ({ page }) => {
  await page.goto("./?theme=dark");
  await settle(page);
  await shot(page, "landing-hero-dark");

  await page.goto("./?theme=light");
  await settle(page);
  await shot(page, "landing-hero-light");

  await page.goto("./?theme=dark#will-it-run");
  await page.locator("#calc-model").selectOption({ label: "Qwen2.5 32B" });
  await page.locator("label[for=hw-linux-box]").click();
  await settle(page, 800);
  await page.locator("#will-it-run").screenshot({ path: `${OUT}/landing-calculator.png`, animations: "disabled" });

  await page.locator("#how").screenshot({ path: `${OUT}/landing-how-it-works.png`, animations: "disabled" });
  await page.locator("#features").screenshot({ path: `${OUT}/landing-features.png`, animations: "disabled" });
});

test("console", async ({ page }) => {
  await page.goto("./console.html?demo&theme=dark#/overview");
  await settle(page, 4000);
  await shot(page, "console-overview-dark");

  await page.goto("./console.html?demo&theme=light#/overview");
  await settle(page, 4000);
  await shot(page, "console-overview-light");

  await page.goto("./console.html?demo&theme=dark#/models");
  await settle(page, 1200);
  await shot(page, "console-models");

  await page.getByRole("button", { name: "Add model" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Hugging Face repo or GGUF path").fill("Qwen/Qwen2.5-14B-Instruct-GGUF");
  await dialog.getByLabel("Context window").selectOption("16384");
  await settle(page, 900);
  await shot(page, "console-add-model");
  await page.keyboard.press("Escape");

  await page.goto("./console.html?demo&theme=dark#/nodes");
  await settle(page, 1500);
  await shot(page, "console-nodes");

  await page.goto("./console.html?demo&theme=dark#/playground");
  await settle(page, 800);
  await page.getByLabel("Message").fill("Which machine answered this?");
  await page.getByLabel("Message").press("Enter");
  await page.locator(".msg--assistant .msg__meta").waitFor({ timeout: 15_000 });
  await page.getByLabel("Message").fill("Explain memory admission in two sentences.");
  await page.getByLabel("Message").press("Enter");
  await page.locator(".msg--assistant .msg__meta").nth(1).waitFor({ timeout: 15_000 });
  await settle(page, 300);
  await shot(page, "console-playground");

  await page.goto("./console.html?demo&theme=light#/access");
  await page.getByLabel("Key name").fill("vscode-laptop");
  await page.getByRole("button", { name: "Create key" }).click();
  await settle(page, 900);
  await shot(page, "console-access");

  await page.goto("./console.html?demo&theme=dark#/audit");
  await settle(page, 900);
  await shot(page, "console-audit");
});

test("mobile", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto("./?theme=dark");
  await settle(page);
  await shot(page, "mobile-landing");
  await page.goto("./console.html?demo&theme=dark#/overview");
  await settle(page, 3000);
  await shot(page, "mobile-console");
  await context.close();
});
