import { test as base } from "@playwright/test";

/**
 * Functional tests must not depend on third-party CDNs: block web fonts so a slow
 * network can never stall page load. (Screenshots keep fonts and use @playwright/test directly.)
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
    await use(page);
  },
});

export { expect } from "@playwright/test";
