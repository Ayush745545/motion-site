import type { Page } from "@playwright/test";

export async function viewportMetrics(page: Page) {
  return page.evaluate(() => {
    const clientWidth = document.documentElement.clientWidth;
    const offenders = [...document.body.querySelectorAll<HTMLElement>("*")]
      .map((element) => {
        const bounds = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          id: element.id,
          className: typeof element.className === "string" ? element.className : "",
          right: Math.round(bounds.right),
          width: Math.round(bounds.width),
          overflowX: getComputedStyle(element).overflowX,
        };
      })
      .filter((element) => element.width > 0 && element.right > clientWidth + 1)
      .slice(0, 12);
    return { clientWidth, scrollWidth: document.documentElement.scrollWidth, offenders };
  });
}
