import { expect, test, type Page } from "./account-fixture";
import { viewportMetrics } from "./viewport";

async function savedProject(page: Page, id: string) {
  const response = await page.request.get(`/api/projects/${id}`);
  expect(response.ok()).toBeTruthy();
  return (await response.json() as { project: { document: { timeline: unknown } } }).project.document;
}

async function currentProjectId(page: Page) {
  const id = new URL(page.url()).searchParams.get("project");
  expect(id).toBeTruthy();
  return id!;
}
async function createProject(page: Page) {
  await page.goto("/create");
  await page.getByLabel("Project name", { exact: true }).fill("Timeline acceptance");
  await page.getByLabel("Website URL", { exact: true }).fill("https://example.com");
  await page.getByRole("button", { name: "Create project", exact: true }).click();
  await page.waitForURL(/\/studio\?project=/);
  await expect(page.locator(".timeline-composition")).toBeVisible();
}
async function editAndUndo(page: Page) {
  await createProject(page);
  await page.getByLabel("Headline", { exact: true }).fill("A shared composition. A real export.");
  await page.getByLabel("Headline", { exact: true }).press("Tab");
  await expect(page.locator(".timeline-composition")).toContainText("A shared composition. A real export.");
  await page.getByLabel("Scene duration (seconds)", { exact: true }).fill("2");
  await page.getByLabel("Scene duration (seconds)", { exact: true }).press("Tab");
  await expect(page.getByLabel("Scene duration (seconds)", { exact: true })).toHaveValue("2");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByLabel("Scene duration (seconds)", { exact: true })).toHaveValue("4");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByLabel("Headline", { exact: true })).toHaveValue("Timeline acceptance");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(page.getByLabel("Headline", { exact: true })).toHaveValue("A shared composition. A real export.");
}

test("timeline edits, timing and history update the real shared composition and survive reload", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await editAndUndo(page);
  await page.getByLabel("Timeline frame", { exact: true }).fill("20");
  await page.getByLabel("Timeline frame", { exact: true }).press("Tab");
  await page.getByRole("button", { name: "Next frame", exact: true }).click();
  await expect(page.getByLabel("Timeline frame", { exact: true })).toHaveValue("21");
  await page.getByRole("button", { name: "Previous frame", exact: true }).click();
  await expect(page.getByLabel("Timeline frame", { exact: true })).toHaveValue("20");
  const projectId = await currentProjectId(page);
  await page.getByRole("button", { name: "Save now", exact: true }).click();
  await expect.poll(async () => {
    const project = await savedProject(page, projectId);
    const timeline = project.timeline as { layers: Array<{ name: string; text?: string }> };
    return timeline.layers.find(layer => layer.name === "Headline")?.text;
  }).toBe("A shared composition. A real export.");
  await page.reload();
  await expect(page.getByLabel("Headline", { exact: true })).toHaveValue("A shared composition. A real export.");
  await page.setViewportSize({ width: 390, height: 844 });
  const layout = await viewportMetrics(page);
  expect(layout.scrollWidth, JSON.stringify(layout)).toBeLessThanOrEqual(layout.clientWidth);
  await page.screenshot({ path: ".cache/screenshots/phase6-timeline-mobile.png", fullPage: true });
  expect(errors).toEqual([]);
});

test("edited and undone timeline exports its exact document to an actual MP4", async ({ page }) => {
  test.skip(process.env.TIMELINE_RENDER_TESTS !== "1", "Enable TIMELINE_RENDER_TESTS=1 for actual encoding");
  test.setTimeout(420_000);
  await editAndUndo(page);
  const projectId = await currentProjectId(page);
  const responsePromise = page.waitForResponse(response => response.url().endsWith("/api/motion/render") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Export MP4", exact: true }).click();
  const response = await responsePromise; expect(response.status()).toBe(202);
  const submitted = response.request().postDataJSON() as { input: { document: { scenes: Array<{ durationInFrames: number }>; layers: Array<{ type: string; text?: string }> } } };
  expect(submitted.input.document.scenes[0]?.durationInFrames).toBe(120);
  expect(submitted.input.document.layers.some(layer => layer.text === "A shared composition. A real export.")).toBe(true);
  const saved = await savedProject(page, projectId);
  expect(submitted.input.document).toEqual(saved.timeline);
  const job = await response.json() as { id: string; project_id: string };
  const download = page.getByRole("link", { name: "Download timeline MP4", exact: true });
  await expect(download).toBeVisible({ timeout: 400_000 });
  const output = await page.request.get(`/api/motion/render/${job.id}/download?project_id=${job.project_id}`, { headers: { Range: "bytes=0-31" } });
  expect(output.status()).toBe(206); expect(output.headers()["content-type"]).toBe("video/mp4");
  expect((await output.body()).toString("ascii")).toContain("ftyp");
  await page.screenshot({ path: ".cache/screenshots/phase6-timeline-export.png", fullPage: true });
  console.log(JSON.stringify({ timelineRenderJob: job.id }));
});

test("image layers, keyframes, drag reorder and zoom use the saved document", async ({ page }) => {
  await createProject(page);
  await page.getByRole("button", { name: "Add text layer", exact: true }).click();
  await page.getByLabel("Headline", { exact: true }).fill("Animated layer");
  await page.getByLabel("Headline", { exact: true }).press("Tab");
  await page.getByLabel("Entrance animation", { exact: true }).selectOption("none");
  await page.getByLabel("Keyframe property", { exact: true }).selectOption("opacity");
  await page.getByLabel("Timeline frame", { exact: true }).fill("0");
  await page.getByLabel("Timeline frame", { exact: true }).press("Tab");
  await page.getByLabel("New keyframe value", { exact: true }).fill("0.2");
  await page.getByRole("button", { name: "Add keyframe", exact: true }).click();
  await page.getByLabel("Timeline frame", { exact: true }).fill("30");
  await page.getByLabel("Timeline frame", { exact: true }).press("Tab");
  await page.getByLabel("New keyframe value", { exact: true }).fill("1");
  await page.getByRole("button", { name: "Add keyframe", exact: true }).click();
  await page.getByLabel("Timeline frame", { exact: true }).fill("15");
  await page.getByLabel("Timeline frame", { exact: true }).press("Tab");
  const animated = page.locator(".timeline-composition [data-layer-id]").filter({ hasText: "Animated layer" });
  await expect.poll(async () => Number(await animated.evaluate(element => getComputedStyle(element).opacity))).toBeCloseTo(0.6, 1);
  await page.getByLabel("Import timeline image", { exact: true }).setInputFiles("packages/motion-engine/public/motion/sample-site.png");
  await expect(page.locator(".timeline-composition img")).toBeVisible();
  await page.getByLabel("Timeline zoom", { exact: true }).fill("200");
  await expect(page.getByLabel("Timeline zoom", { exact: true })).toHaveValue("200");
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.getByLabel("Timeline zoom", { exact: true }).fill("50");
  await page.getByRole("button", { name: "Select scene 1: Opening", exact: true }).dragTo(page.getByRole("button", { name: "Select scene 3: Call to action", exact: true }));
  await expect(page.getByRole("button", { name: "Select scene 3: Opening", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Save now", exact: true }).click();
  const project = await savedProject(page, await currentProjectId(page));
  const timeline = project.timeline as { assets: unknown[]; layers: Array<{ keyframes: unknown[] }> };
  expect(timeline.assets).toHaveLength(1);
  expect(timeline.layers.some(layer => layer.keyframes.length === 2)).toBe(true);
});
