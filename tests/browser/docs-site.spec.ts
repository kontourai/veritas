import { expect, test, type Page } from "@playwright/test";

test("renders the Veritas landing page and primary docs navigation", async ({ page }) => {
  const consoleErrors = await loadDocsPage(page, "/index.html");

  await expect(page).toHaveTitle(/Trustworthy AI-Assisted Development \| Veritas/);
  await expect(page.locator(".brand")).toHaveText("Veritas");
  await expect(page.getByRole("heading", { name: "Earn merge autonomy for AI-authored code." })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("Repo Standards");
  await expect(page.getByRole("main")).toContainText("Readiness Report");
  await expect(page.getByRole("main")).toContainText("Protected Standards");
  await expect(page.getByRole("navigation").getByRole("link", { name: "Concepts" })).toBeVisible();
  await expect(page.getByRole("navigation").getByRole("link", { name: "Docs" })).toBeVisible();
  await assertSiteStylesResolved(page);
  expect(consoleErrors).toEqual([]);
});

test("renders linked docs pages and preserves product vocabulary", async ({ page }) => {
  const consoleErrors = await loadDocsPage(page, "/docs/concepts.html");

  await expect(page).toHaveTitle(/Concepts \| Veritas/);
  await expect(page.getByRole("heading", { name: "Concepts" })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("Merge Readiness");
  await expect(page.getByRole("main")).toContainText("Verification Authority");

  await page.getByRole("navigation").getByRole("link", { name: "Docs" }).click();
  await expect(page).toHaveURL(/\/docs\/README\.html$/);
  await expect(page.getByRole("heading", { name: "Documentation" })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("Agent Runtime Integrations");
  expect(consoleErrors).toEqual([]);
});

test("toggles theme without losing page structure", async ({ page }) => {
  const consoleErrors = await loadDocsPage(page, "/index.html");

  await page.getByRole("button", { name: "Toggle dark/light mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", /dark|light/);
  await expect(page.getByRole("heading", { name: "Earn merge autonomy for AI-authored code." })).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

test("keeps header and content inside the mobile viewport", async ({ page }) => {
  test.skip(test.info().project.name !== "chromium-mobile", "mobile-only layout check");
  const consoleErrors = await loadDocsPage(page, "/index.html");

  const viewport = page.viewportSize();
  const headerBox = await page.locator(".site-header .shell").boundingBox();
  const contentBox = await page.locator("main.content").boundingBox();
  expect(viewport).not.toBeNull();
  expect(headerBox).not.toBeNull();
  expect(contentBox).not.toBeNull();

  if (viewport && headerBox && contentBox) {
    expect(headerBox.x).toBeGreaterThanOrEqual(0);
    expect(contentBox.x).toBeGreaterThanOrEqual(0);
    expect(headerBox.x + headerBox.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(contentBox.x + contentBox.width).toBeLessThanOrEqual(viewport.width + 1);
  }

  expect(consoleErrors).toEqual([]);
});

async function loadDocsPage(page: Page, path: string): Promise<string[]> {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(error.message);
  });

  await page.goto(`/veritas${path}`);
  await expect(page.locator("body")).toBeVisible();
  return consoleErrors;
}

async function assertSiteStylesResolved(page: Page): Promise<void> {
  const styles = await page.locator("body").evaluate((body) => {
    const computed = getComputedStyle(body);
    return {
      background: computed.backgroundColor,
      color: computed.color,
      fontFamily: computed.fontFamily,
    };
  });

  expect(styles.background).not.toBe("rgba(0, 0, 0, 0)");
  expect(styles.color).not.toBe("rgba(0, 0, 0, 0)");
  expect(styles.fontFamily).not.toBe("");
}
