import { expect, test } from "@playwright/test";

const apiBaseUrl = process.env.API_BASE_URL ?? "http://127.0.0.1:8000";

test("Next.js proxies the live FastAPI health and PostgreSQL readiness", async ({ request }) => {
  const health = await request.get("/api/health", { headers: { "X-Request-ID": "foundation-e2e" } });
  expect(health.status()).toBe(200);
  expect(health.headers()["x-request-id"]).toBe("foundation-e2e");
  expect(await health.json()).toMatchObject({
    status: "ok", service: "motion-dna-ai-api", version: "0.1.0", environment: "development",
  });
  const ready = await request.get("/api/ready");
  expect(ready.status(), "Start PostgreSQL before the integration check").toBe(200);
  expect(await ready.json()).toEqual({ status: "ok", database: "connected" });
});

test("desktop workspace protects projects behind local account sign-in", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/settings");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sign in to open your projects.");
  await page.getByRole("link", { name: "Create account or sign in" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Create your account.");
  await expect(page.getByRole("link", { name: "API reference" })).toHaveAttribute("href", `${apiBaseUrl}/docs`);
  expect(errors).toEqual([]);
});

test("mobile account gate fits the viewport and keeps a clear sign-in action", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/settings");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sign in to open your projects.");
  await expect(page.getByRole("link", { name: "Create account or sign in" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
