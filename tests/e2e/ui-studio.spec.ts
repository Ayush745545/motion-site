import { expect, test, type Page } from "./account-fixture";

type SavedWorkspace = {
  projects: Array<{ id: string; name: string; resolution: string; fps: number; sourceType: string; sourceName?: string; source: string; scenes: Array<{ headline: string; duration: number }> }>;
};

async function savedWorkspace(page: Page): Promise<SavedWorkspace> {
  const response = await page.request.get("/api/projects");
  expect(response.ok()).toBeTruthy();
  const body = await response.json() as { projects: Array<{ id: string; document: Omit<SavedWorkspace["projects"][number], "id"> }> };
  return { projects: body.projects.map(({ id, document }) => ({ id, ...document })) };
}

async function savedDocument(page: Page) {
  const projectId = new URL(page.url()).searchParams.get("project");
  expect(projectId).toBeTruthy();
  const response = await page.request.get(`/api/projects/${projectId}`);
  expect(response.ok()).toBeTruthy();
  return (await response.json() as { project: { document: Record<string, unknown> } }).project.document;
}

async function createWebsiteProject(page: Page, name: string) {
  await page.goto("/create");
  await page.getByLabel("Project name", { exact: true }).fill(name);
  await page.getByLabel("Website URL", { exact: true }).fill("https://example.com/product");
  await page.getByRole("button", { name: "Create project", exact: true }).click();
  await expect(page).toHaveURL(/\/studio\?project=[^&]+$/);
  await expect.poll(async () => (await savedWorkspace(page)).projects[0]?.name).toBe(name);
}

test("project creation validates a URL and keeps a real draft after reload", async ({ page }) => {
  await page.goto("/create");
  await page.getByLabel("Project name", { exact: true }).fill("Product launch");
  await page.getByLabel("Website URL", { exact: true }).fill("javascript:alert(1)");
  await page.getByRole("button", { name: "Create project", exact: true }).click();
  await expect(page.locator("#source-error")).toContainText("Enter a complete HTTP or HTTPS URL");
  await expect(page).toHaveURL(/\/create$/);
  expect((await savedWorkspace(page)).projects.some(({ name }) => name === "Product launch")).toBe(false);

  await page.getByLabel("Website URL", { exact: true }).fill("https://example.com/product");
  await page.getByRole("button", { name: "Create project", exact: true }).click();
  await expect(page).toHaveURL(/\/studio\?project=[^&]+$/);
  const editorUrl = page.url();
  await page.reload();
  await expect(page).toHaveURL(editorUrl);
  await page.goto("/");
  await expect(page.getByText("Product launch", { exact: true }).first()).toBeVisible();
  const project = (await savedWorkspace(page)).projects.find(({ name }) => name === "Product launch");
  expect(project).toMatchObject({ name: "Product launch", sourceType: "url", source: "https://example.com/product" });
  expect(project?.scenes).toHaveLength(3);
});

test("saved preferences survive reload and become new project defaults", async ({ page }) => {
  await page.goto("/settings");
  await page.getByLabel("Default resolution", { exact: true }).selectOption("1080x1920");
  await page.getByLabel("Default frame rate", { exact: true }).selectOption("60");
  await page.getByRole("switch", { name: "Reduce interface motion", exact: true }).check();
  await page.reload();
  await expect(page.getByLabel("Default resolution", { exact: true })).toHaveValue("1080x1920");
  await expect(page.getByLabel("Default frame rate", { exact: true })).toHaveValue("60");
  await expect(page.getByRole("switch", { name: "Reduce interface motion", exact: true })).toBeChecked();
  await createWebsiteProject(page, "Vertical launch");
  expect((await savedWorkspace(page)).projects.find(({ name }) => name === "Vertical launch")).toMatchObject({ resolution: "1080x1920", fps: 60 });
  await page.goto("/settings");
  await page.getByRole("button", { name: "Reset preferences", exact: true }).click();
  await expect(page.getByLabel("Default resolution", { exact: true })).toHaveValue("1920x1080");
  await expect(page.getByLabel("Default frame rate", { exact: true })).toHaveValue("30");
  await expect(page.getByRole("switch", { name: "Reduce interface motion", exact: true })).not.toBeChecked();
  expect((await savedWorkspace(page)).projects[0]).toMatchObject({ resolution: "1080x1920", fps: 60 });
});

test("the editor saves scene properties and supports keyboard playback", async ({ page }) => {
  const clientErrors: string[] = [];
  page.on("pageerror", (error) => clientErrors.push(error.message));
  await createWebsiteProject(page, "Motion study");
  await page.getByLabel("Headline", { exact: true }).fill("Frame by frame.");
  await expect(page.locator(".timeline-composition")).toContainText("Frame by frame.");
  await page.getByLabel("Scene duration (seconds)", { exact: true }).fill("6");
  await page.getByLabel("Composition resolution", { exact: true }).selectOption("1080x1080");
  await page.getByLabel("Text hex", { exact: true }).fill("#12ABEF");
  await page.getByLabel("Typeface", { exact: true }).selectOption("serif");
  await page.getByLabel("Entrance animation", { exact: true }).selectOption("slide");
  await expect.poll(async () => {
    const document = await savedDocument(page);
    const timeline = document.timeline as { composition: { width: number; height: number }; layers: Array<{ name: string; text?: string; color?: string; fontFamily?: string; animation: { preset: string } }> };
    const headline = timeline.layers.find(layer => layer.name === "Headline");
    return { headline: headline?.text, color: headline?.color, fontFamily: headline?.fontFamily, animation: headline?.animation.preset, width: timeline.composition.width, height: timeline.composition.height };
  }).toEqual({ headline: "Frame by frame.", color: "#12ABEF", fontFamily: "serif", animation: "slide", width: 1080, height: 1080 });
  await page.reload();
  await expect(page.getByLabel("Headline", { exact: true })).toHaveValue("Frame by frame.");
  await expect(page.getByLabel("Scene duration (seconds)", { exact: true })).toHaveValue("6");
  await expect(page.getByLabel("Composition resolution", { exact: true })).toHaveValue("1080x1080");
  await expect(page.getByLabel("Text hex", { exact: true })).toHaveValue("#12ABEF");
  await expect(page.getByLabel("Typeface", { exact: true })).toHaveValue("serif");
  await expect(page.getByLabel("Entrance animation", { exact: true })).toHaveValue("slide");

  // Invalid intermediate edits preserve the last valid draft instead of throwing.
  await page.getByLabel("Scene duration (seconds)", { exact: true }).fill("0");
  await page.getByLabel("Scene name", { exact: true }).focus();
  await expect(page.getByLabel("Scene duration (seconds)", { exact: true })).toHaveValue("6");
  await page.getByLabel("Scene name", { exact: true }).fill("");
  await page.getByLabel("Headline", { exact: true }).focus();
  await expect(page.getByLabel("Scene name", { exact: true })).toHaveValue("Opening");

  await page.getByRole("button", { name: "Duplicate scene", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Select scene \d+:/ })).toHaveCount(4);
  await page.getByRole("button", { name: "Delete scene", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Select scene \d+:/ })).toHaveCount(3);
  await page.getByRole("button", { name: "Select scene 1: Opening", exact: true }).click();
  await page.getByRole("heading", { name: /Motion studio/, level: 1 }).click();
  const initialTime = await page.getByTestId("preview-time").textContent();
  await page.keyboard.press("Space");
  await expect(page.getByRole("region", { name: "Motion editor", exact: true })).toHaveAttribute("data-playing", "true");
  await expect(page.getByTestId("preview-time")).not.toHaveText(initialTime ?? "");
  await page.keyboard.press("Space");
  await expect(page.getByRole("region", { name: "Motion editor", exact: true })).toHaveAttribute("data-playing", "false");
  await expect(page.getByRole("link", { name: "Generate DNA video", exact: true })).toHaveAttribute("href", /\/generate\?project=/);
  expect(clientErrors).toEqual([]);
});

test("mobile source-file creation and all six pages fit the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/create");
  await page.getByLabel("Project name", { exact: true }).fill("Local source film");
  await page.getByRole("button", { name: /Source code Bring your own source/i }).click();
  await page.getByLabel("Choose a source file", { exact: true }).setInputFiles({
    name: "archive.zip", mimeType: "application/zip", buffer: Buffer.from("not source code"),
  });
  await expect(page.locator("#source-error")).toContainText("Choose a text, JavaScript, TypeScript");
  await page.getByLabel("Choose a source file", { exact: true }).setInputFiles({
    name: "landing.html", mimeType: "text/html", buffer: Buffer.from("<main><h1>Local launch</h1></main>"),
  });
  await expect(page.getByLabel("Source code", { exact: true })).toHaveValue("<main><h1>Local launch</h1></main>");
  await page.getByRole("button", { name: "Create project", exact: true }).click();
  await expect(page).toHaveURL(/\/studio\?project=[^&]+$/);
  expect((await savedWorkspace(page)).projects[0]).toMatchObject({ sourceType: "code", sourceName: "landing.html" });

  for (const path of ["/", "/create", "/analysis", "/studio", "/queue", "/settings"]) {
    await page.getByRole("button", { name: "Open navigation", exact: true }).click();
    await page.getByRole("dialog").locator(`a[href="${path}"]`).click();
    await expect(page).toHaveURL(new RegExp(`${path === "/" ? "/" : path}(?:\\?.*)?$`));
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${path} must fit a 390px viewport`).toBe(true);
  }
});
