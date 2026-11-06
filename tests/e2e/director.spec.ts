import { expect, test } from "./account-fixture";
import { viewportMetrics } from "./viewport";

test("Director generates grounded scenes, regenerates, edits and previews reorder/style",async({page})=>{
 const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
 await page.goto("/director");await page.getByLabel("Website content summary").fill("Flowdesk SaaS dashboard for small teams.\nTrack project milestones.\nShare notes with your team.");
 await page.getByLabel("Director duration").fill("20");await page.getByRole("button",{name:"Generate storyboard",exact:true}).click();
 await expect(page.getByTestId("director-model")).toContainText("rules-v1");await expect(page.getByLabel("intro headline",{exact:true})).toHaveValue("Flowdesk SaaS dashboard for small teams.");
 await page.getByLabel("intro description",{exact:true}).fill("Open on the source headline with a quiet brand reveal.");await page.getByLabel("intro description",{exact:true}).press("Tab");
 await page.getByRole("button",{name:"Preview intro",exact:true}).click();await expect(page.locator(".motion-composition")).toContainText("Open on the source headline with a quiet brand reveal.");
 await page.getByLabel("intro motion preset").selectOption("fade");await page.getByLabel("intro transition").selectOption("cut");await page.getByRole("button",{name:"Move features earlier",exact:true}).click();
 await expect(page.locator(".director-scene").nth(1)).toHaveAttribute("data-testid","directed-features");
 await page.getByRole("button",{name:"Regenerate storyboard",exact:true}).click();await expect(page.getByLabel("intro headline",{exact:true})).toHaveValue("Track project milestones.");
 await page.getByLabel("Website content summary").fill("Handmade ceramic cups.\nShop our stoneware collection.\nEvery cup is glazed by hand.");await page.getByLabel("Product category").selectOption("ecommerce");await page.getByLabel("Director motion style").selectOption("typography");await page.getByRole("button",{name:"Regenerate storyboard",exact:true}).click();
 await expect(page.locator(".director-concept")).toContainText("ecommerce");await expect(page.locator(".director-evidence")).toContainText("glazed by hand");
 await page.screenshot({path:".cache/screenshots/phase5-director-desktop.png",fullPage:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:".cache/screenshots/phase5-director-mobile.png",fullPage:true});const layout=await viewportMetrics(page);expect(layout.scrollWidth,JSON.stringify(layout)).toBeLessThanOrEqual(layout.clientWidth);expect(errors).toEqual([]);
});
