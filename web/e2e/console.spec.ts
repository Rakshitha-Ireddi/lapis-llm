import { expect, test } from "./fixtures";

test.describe("console (demo mode)", () => {
  let errors: string[] = [];
  test.beforeEach(async ({ page }) => {
    errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
  });
  test.afterEach(() => {
    expect(errors, "uncaught page errors").toEqual([]);
  });

  test("overview shows the fleet", async ({ page }) => {
    await page.goto("./console.html?demo#/overview");
    await expect(page.locator("#mode-pill")).toHaveText("demo");
    await expect(page.locator("#k-nodes")).toContainText("5");
    await expect(page.locator("#o-board tr")).toHaveCount(6);
    await expect(page.locator("#pending-badge")).toHaveText("1");
  });

  test("start a stopped model and see it placed", async ({ page }) => {
    await page.goto("./console.html?demo#/models");
    const row = page.locator('tr[data-model="mistral-small-24b"]');
    await expect(row.locator(".pill")).toHaveText("stopped");
    await row.getByRole("button", { name: "Start" }).click();
    await expect(row.locator(".pill")).toHaveText("running");
    await expect(row).toContainText("macbook-pro");
  });

  test("add-model dialog previews placement and explains refusals", async ({ page }) => {
    await page.goto("./console.html?demo#/models");
    await page.getByRole("button", { name: "Add model" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Hugging Face repo or GGUF path").fill("Qwen/Qwen2.5-3B-Instruct-GGUF");
    await expect(dialog.getByLabel(/Model name/)).toHaveValue("qwen2.5-3b-instruct");
    await expect(dialog.getByLabel("Parameters (B)")).toHaveValue("3");
    await expect(dialog.locator("#add-budget")).not.toHaveText("–");
    await expect(dialog.locator(".preview li.chosen")).toHaveCount(1);
    await dialog.getByRole("button", { name: "Add & start" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('tr[data-model="qwen2.5-3b-instruct"] .pill')).toHaveText("running");
  });

  test("approve a pending node with its fingerprint", async ({ page }) => {
    await page.goto("./console.html?demo#/nodes");
    const card = page.locator(".node-card.pending");
    await expect(card).toHaveCount(1);
    await card.getByRole("textbox").fill("00:11");
    await card.getByRole("button", { name: "Approve" }).click();
    await expect(page.locator(".toast--bad")).toContainText("does not match");
    const fp = (await card.locator(".fp").textContent())!.trim();
    await card.getByRole("textbox").fill(fp);
    await card.getByRole("button", { name: "Approve" }).click();
    await expect(page.locator(".node-card.pending")).toHaveCount(0);
    await expect(page.locator(".node-card", { hasText: "old-laptop" })).toContainText("online");
  });

  test("create an API key that is shown once", async ({ page }) => {
    await page.goto("./console.html?demo#/access");
    await page.getByLabel("Key name").fill("e2e-laptop");
    await page.getByRole("button", { name: "Create key" }).click();
    await expect(page.locator("#a-secret-value")).toHaveText(/^lap_/);
    await expect(page.locator("tr", { hasText: "e2e-laptop" })).toBeVisible();
  });

  test("playground streams a reply and shows the routed node", async ({ page }) => {
    await page.goto("./console.html?demo#/playground");
    await page.getByLabel("Message").fill("hello fleet");
    await page.getByLabel("Message").press("Enter");
    const reply = page.locator(".msg--assistant").last();
    await expect(reply).toContainText("routed to", { timeout: 15_000 });
    await expect(reply).toContainText("Hi from");
  });

  test("audit log records actions", async ({ page }) => {
    await page.goto("./console.html?demo#/models");
    await page.locator('tr[data-model="gemma-2-9b-it"]').getByRole("button", { name: "Stop" }).click();
    await page.getByRole("link", { name: "Audit log" }).click();
    await expect(page.locator("#au-list li").first()).toContainText("model.stop");
  });
});
