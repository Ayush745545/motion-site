"""One disposable, networkless browser. JSON-lines IPC is its only broker channel."""

import asyncio
import base64
import json
import sys
from pathlib import Path

from playwright.async_api import async_playwright

EXTRACT = Path(__file__).with_name("extract.js").read_text()


async def capture(url, fetch):
    warnings = []
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(
            headless=True,
            args=[
                "--disable-dev-shm-usage",
                "--disable-background-networking",
                "--disable-extensions",
            ],
        )
        context = await browser.new_context(
            viewport={"width": 1440, "height": 900},
            device_scale_factor=1,
            service_workers="block",
            accept_downloads=False,
            permissions=[],
        )
        page = await context.new_page()
        fatal = []

        async def route_request(route):
            request = route.request
            if request.method != "GET" or request.resource_type in {"media", "websocket", "other"}:
                await route.abort()
                return
            if request.is_navigation_request() and request.frame != page.main_frame:
                await route.abort()
                return
            try:
                result = await fetch(request.url)
                if "error" in result:
                    if request.is_navigation_request():
                        fatal.append(result["error"])
                    warnings.append(result["error"])
                    await route.abort()
                elif result["url"] != request.url:
                    await route.fulfill(status=302, headers={"location": result["url"]})
                else:
                    if request.is_navigation_request() and result["status"] >= 400:
                        fatal.append("The website returned an HTTP error.")
                    await route.fulfill(
                        status=result["status"],
                        headers=result["headers"],
                        body=base64.b64decode(result["body"]),
                    )
            except Exception:
                warnings.append("A resource could not be loaded.")
                await route.abort()

        await context.route("**/*", route_request)
        await context.route_web_socket("**/*", lambda socket: socket.close())
        context.on(
            "page",
            lambda new_page: asyncio.create_task(new_page.close()) if new_page != page else None,
        )
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=20000)
        except Exception:
            if fatal:
                raise RuntimeError(fatal[0]) from None
            raise RuntimeError("The page did not load within 20 seconds.") from None
        await page.wait_for_timeout(1500)
        try:
            await page.evaluate(
                "() => Promise.race([document.fonts.ready, new Promise(r=>setTimeout(r,2000))])"
            )
        except Exception:
            warnings.append("Fonts did not finish loading.")
        if fatal:
            raise RuntimeError(fatal[0])
        data = await page.evaluate(EXTRACT)
        # No form values, iframe content or editable surfaces in saved screenshots.
        mask = page.locator("input, textarea, select, [contenteditable], iframe")
        screenshots = {
            "viewport": base64.b64encode(
                await page.screenshot(type="png", animations="disabled", mask=[mask], timeout=5000)
            ).decode()
        }
        data["warnings"] = list(dict.fromkeys(data["warnings"] + warnings))[:20]
        data["final_url"] = page.url
        await context.close()
        await browser.close()
        return {"data": data, "screenshots": screenshots}


async def main():
    initial = json.loads(sys.stdin.readline())
    lock = asyncio.Lock()

    async def fetch(url):
        async with lock:
            print(json.dumps({"type": "fetch", "url": url}), flush=True)
            return json.loads(await asyncio.to_thread(sys.stdin.readline))

    try:
        result = await capture(initial["url"], fetch)
        print(json.dumps({"type": "result", **result}), flush=True)
    except Exception as exc:
        message = (
            str(exc)[:200] if isinstance(exc, RuntimeError) else "The page could not be inspected."
        )
        print(json.dumps({"type": "error", "message": message}), flush=True)


if __name__ == "__main__":
    asyncio.run(main())
