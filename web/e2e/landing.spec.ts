import { expect, test } from "./fixtures";

test.describe("landing page", () => {
  test("renders the hero and the live demo panel", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("./");
    await expect(page).toHaveTitle(/LapisLLM/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("One endpoint.");
    await expect(page.locator("#hero-node-list li")).toHaveCount(5);
    await expect(page.locator("#hero-tps")).not.toHaveText("0");
    expect(errors).toEqual([]);
  });

  test("calculator says a 70B model won't fit an 8 GB gaming PC", async ({ page }) => {
    await page.goto("./#will-it-run");
    await expect(page.locator("#calc-verdict")).toHaveText("Runs comfortably");
    await page.locator("#calc-model").selectOption({ label: "Llama 3.3 70B" });
    await expect(page.locator("#calc-verdict")).toHaveText("Won't fit");
    await expect(page.locator("#calc-note")).toContainText("DGX Spark class");
    await page.locator("label[for=hw-spark]").click();
    await expect(page.locator("#calc-verdict")).toHaveText("Runs comfortably");
    await expect(page.locator("#calc-needed")).toHaveText("40.0 GiB");
  });

  test("code tabs switch panels", async ({ page }) => {
    await page.goto("./#api");
    await page.getByRole("tab", { name: "curl" }).click();
    await expect(page.locator('[data-panel="sh"]')).toBeVisible();
    await expect(page.locator('[data-panel="py"]')).toBeHidden();
  });

  test("theme toggle flips and remembers the theme", async ({ page }) => {
    await page.goto("./?theme=light");
    const html = page.locator("html");
    await expect(html).toHaveAttribute("data-theme", "light");
    await page.locator("[data-theme-toggle]").first().click();
    await expect(html).toHaveAttribute("data-theme", "dark");
    await page.goto("./");
    await expect(html).toHaveAttribute("data-theme", "dark");
  });

  test("links to the console", async ({ page }) => {
    await page.goto("./");
    await page.getByRole("link", { name: "Try the live demo" }).click();
    await expect(page).toHaveURL(/console\.html/);
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  });
});
