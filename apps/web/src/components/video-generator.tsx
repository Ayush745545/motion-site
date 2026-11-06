"use client";
import dynamic from "next/dynamic";
export const VideoGenerator=dynamic(()=>import("./video-workspace").then(module=>module.VideoWorkspace),{ssr:false,loading:()=> <div role="status" className="editor-loading">Opening the frame-accurate studio…</div>});
