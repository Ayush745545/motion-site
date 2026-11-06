import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIRequestContext } from "./account-fixture";
import { viewportMetrics } from "./viewport";

async function readJob(request: APIRequestContext, id: string, projectId: string) {
 const response = await request.get(`/api/motion/render/${id}?project_id=${projectId}`, { timeout: 15_000 });
 expect(response.ok()).toBeTruthy();
 return response.json() as Promise<{id:string;status:string;stage:string;progress:number;project_id:string;output?:{width:number;height:number;fps:number;frames:number;duration:number;codec:string};download_url?:string}>;
}

test("Remotion Player seeks exact frames, switches templates, and fits mobile portrait",async({page})=>{
 const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
 await page.goto("/generate");await expect(page.getByRole("heading",{name:"DNA video studio"})).toBeVisible();
 await page.getByLabel("Video frame",{exact:true}).fill("140");await page.getByLabel("Video frame",{exact:true}).press("Tab");
 await expect(page.locator(".motion-composition img")).toBeVisible();
 await page.getByRole("button",{name:"Next frame",exact:true}).click();await expect(page.getByLabel("Video frame",{exact:true})).toHaveValue("141");
 await page.getByRole("button",{name:"Previous frame",exact:true}).click();await expect(page.getByLabel("Video frame",{exact:true})).toHaveValue("140");
 for(const title of ["Modern SaaS promotion","Minimal typography","Dynamic technology showcase","App interface walkthrough","Cinematic product launch"]){await page.getByRole("button",{name:new RegExp(title)}).click();await expect(page.getByRole("button",{name:new RegExp(title)})).toHaveAttribute("aria-pressed","true");}
 await page.getByLabel("Video frame",{exact:true}).fill("280");await page.getByLabel("Video frame",{exact:true}).press("Tab");await expect(page.locator('.motion-composition [data-motion-safe="card"]')).toHaveCount(3);
 await page.screenshot({path:".cache/screenshots/phase4-player-desktop.png",fullPage:true});
 await page.getByLabel("Video resolution").selectOption("portrait");await page.setViewportSize({width:390,height:844});await page.getByLabel("Video frame",{exact:true}).fill("280");await page.getByLabel("Video frame",{exact:true}).press("Tab");
 await expect(page.locator(".motion-composition")).toBeVisible();const layout=await viewportMetrics(page);expect(layout.scrollWidth,JSON.stringify(layout)).toBeLessThanOrEqual(layout.clientWidth);
 await page.screenshot({path:".cache/screenshots/phase4-player-mobile.png",fullPage:true});
 expect(errors).toEqual([]);
});

test("video copy and template persist with a saved project",async({page})=>{
 await page.goto("/create");await page.getByLabel("Project name",{exact:true}).fill("Frame Studio");await page.getByLabel("Website URL",{exact:true}).fill("https://example.com");await page.getByRole("button",{name:"Create project",exact:true}).click();await page.getByRole("link",{name:"Generate DNA video",exact:true}).click();
 await page.getByLabel("Video CTA").fill("Build something worth seeing.");await page.getByRole("button",{name:/Minimal typography/}).click();const projectId=new URL(page.url()).searchParams.get("project");expect(projectId).toBeTruthy();await expect.poll(async()=>{const response=await page.request.get(`/api/projects/${projectId}`);if(!response.ok())return null;const body=await response.json() as {project:{document:{videoDraft?:{cta:string;template:string}}}};return body.project.document.videoDraft;}).toMatchObject({cta:"Build something worth seeing.",template:"typography"});await page.reload();await expect(page.getByLabel("Video CTA")).toHaveValue("Build something worth seeing.");await expect(page.getByRole("button",{name:/Minimal typography/})).toHaveAttribute("aria-pressed","true");
});

test("the queue exports a verified 15-second MP4 at the selected settings",async({page})=>{
 test.skip(process.env.VIDEO_RENDER_TESTS!=="1","Run pnpm test:video:e2e for actual local encoding");test.setTimeout(420_000);
 await page.goto("/create");await page.getByLabel("Project name",{exact:true}).fill("Verified video export");await page.getByLabel("Website URL",{exact:true}).fill("https://example.com");await page.getByRole("button",{name:"Create project",exact:true}).click();
 const projectId=new URL(page.url()).searchParams.get("project");expect(projectId).toBeTruthy();await page.goto(`/generate?project=${projectId}`);
 await page.getByLabel("Export quality").selectOption("720p");
 await page.getByLabel("Export aspect ratio").selectOption("9:16");
 await page.getByLabel("Export frame rate").selectOption("24");
 const submitted=page.waitForResponse(response=>response.url().endsWith("/api/motion/render")&&response.request().method()==="POST");
 await page.getByRole("button",{name:"Render MP4",exact:true}).click();
 const created=await (await submitted).json() as {id:string;project_id:string};
 const download=page.getByRole("link",{name:/Download finished MP4/});await expect(download).toBeVisible({timeout:400_000});
 const completed=await readJob(page.request,created.id,projectId!);
 expect(completed.status).toBe("completed");expect(completed.project_id).toBe(projectId);
 expect(completed.output).toMatchObject({width:720,height:1280,fps:24,frames:360,duration:15,codec:"h264"});
 const video=path.resolve("storage/renders",created.id,"video.mp4");expect(existsSync(video)).toBe(true);
 const probe=JSON.parse(execFileSync("ffprobe",["-v","error","-select_streams","v:0","-count_frames","-show_entries","stream=codec_name,width,height,r_frame_rate,nb_read_frames","-show_entries","format=duration","-of","json",video],{encoding:"utf8"})) as {streams:Array<{codec_name:string;width:number;height:number;r_frame_rate:string;nb_read_frames:string}>;format:{duration:string}};
 expect(probe.streams[0]).toMatchObject({codec_name:"h264",width:720,height:1280,r_frame_rate:"24/1",nb_read_frames:"360"});expect(Number(probe.format.duration)).toBe(15);
 const url=await download.getAttribute("href");expect(url).toBeTruthy();const response=await page.request.get(url!,{headers:{Range:"bytes=0-31"}});expect(response.status()).toBe(206);expect((await response.body()).toString("ascii")).toContain("ftyp");expect(response.headers()["content-type"]).toBe("video/mp4");
 const wrongOwner=await page.request.get(`/api/motion/render/${created.id}/download?project_id=00000000-0000-4000-8000-000000000099`);expect(wrongOwner.status()).toBe(404);
 const invalid=await page.request.get(url!,{headers:{Range:"bytes=999999999999-"}});expect(invalid.status()).toBe(416);
 await page.goto("/queue");await expect(page.getByRole("link",{name:"Download MP4"}).first()).toBeVisible();
});

test("queue cancellation stops a live renderer without publishing a partial file",async({page})=>{
 test.skip(process.env.VIDEO_RENDER_TESTS!=="1","Run pnpm test:video:e2e to exercise cancellation of a live local encoder");test.setTimeout(180_000);
 await page.goto("/create");const projectName=`Cancellation fixture ${crypto.randomUUID().slice(0,8)}`;await page.getByLabel("Project name",{exact:true}).fill(projectName);await page.getByLabel("Website URL",{exact:true}).fill("https://example.com");await page.getByRole("button",{name:"Create project",exact:true}).click();const projectId=new URL(page.url()).searchParams.get("project");expect(projectId).toBeTruthy();
 const payload={project_id:projectId,project_name:projectName,idempotency_key:`cancel-${crypto.randomUUID()}`,input:{document:{schemaVersion:"1.0",composition:{width:1920,height:1080,fps:30},scenes:[{id:"long-scene",name:"Cancellation fixture",durationInFrames:1800,background:"#101010",transition:{preset:"cut",durationInFrames:0}}],layers:[],assets:[],export:{codec:"h264",crf:18,pixelFormat:"yuv420p"}}},output:{quality:"1080p",aspect_ratio:"16:9",fps:60}};
 const submitted=await page.request.post("/api/motion/render",{data:payload});expect(submitted.status()).toBe(202);const job=await submitted.json() as {id:string};
 let active=await readJob(page.request,job.id,projectId!);const deadline=Date.now()+90_000;
 while(active.stage!=="Rendering and encoding"&&active.status!=="failed"&&Date.now()<deadline){await new Promise(resolve=>setTimeout(resolve,250));active=await readJob(page.request,job.id,projectId!);}
 expect(active.stage).toBe("Rendering and encoding");
 await page.goto("/queue");const row=page.locator("article.queue-job").filter({hasText:projectName});await expect(row).toBeVisible();await row.getByRole("button",{name:"Cancel render"}).click();
 let final=await readJob(page.request,job.id,projectId!);const cancelDeadline=Date.now()+30_000;
 while(final.status!=="cancelled"&&Date.now()<cancelDeadline){await new Promise(resolve=>setTimeout(resolve,250));final=await readJob(page.request,job.id,projectId!);}
 expect(final.status).toBe("cancelled");
 const download=await page.request.get(`/api/motion/render/${job.id}/download?project_id=${projectId}`);expect(download.status()).toBe(404);
 expect(existsSync(path.resolve("storage/renders",job.id,"video.mp4"))).toBe(false);
});
