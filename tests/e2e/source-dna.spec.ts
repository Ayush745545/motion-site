import path from "node:path";
import { expect, test } from "./account-fixture";

test("imports a trusted local Next.js signature and displays its source storyboard", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));

  await page.goto("/create");
  await page.getByLabel("Project name", { exact: true }).fill("Local source acceptance");
  await page.getByRole("button", { name: /Source code/ }).click();
  await page.getByLabel("Source code", { exact: true }).fill("export const marker = 'safe';");
  await page.getByRole("button", { name: "Create project", exact: true }).click();
  await expect(page).toHaveURL(/\/studio\?project=/);
  const projectId = new URL(page.url()).searchParams.get("project");
  expect(projectId).toBeTruthy();

  await page.goto(`/analysis?project=${projectId}`);
  await page.getByLabel("Choose local source DNA JSON").setInputFiles(
    path.resolve("apps/web/tests/fixtures/source-next-dna.json"),
  );

  await expect(page.getByText("TECHNOLOGY FINGERPRINT", { exact: true })).toBeVisible();
  await expect(page.getByText("Next.js", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Tailwind CSS", { exact: true })).toBeVisible();
  await expect(page.getByText("/studio", { exact: true })).toBeVisible();
  await expect(page.getByText("STATICALLY GENERATED STORYBOARD", { exact: true })).toBeVisible();
  await expect(page.getByText("Built with Next.js", { exact: true })).toBeVisible();
  await expect(page.getByText(/not cryptographically verified/)).toBeVisible();

  await expect.poll(async () => {
    const response = await page.request.get(`/api/projects/${projectId}`);
    if (!response.ok()) return null;
    const body = await response.json() as { project: { document: { sourceDNA?: { source_name: string } } } };
    return body.project.document.sourceDNA?.source_name;
  }).toBe("Atlas Product Studio");
  await page.reload();
  await expect(page.getByText("TECHNOLOGY FINGERPRINT", { exact: true })).toBeVisible();
  await expect(page.getByText("STATICALLY GENERATED STORYBOARD", { exact: true })).toBeVisible();
  expect(pageErrors).toEqual([]);
});
