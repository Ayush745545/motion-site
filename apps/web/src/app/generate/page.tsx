import { Suspense } from "react";
import { VideoGenerator } from "@/components/video-generator";
export default function GeneratePage(){return <Suspense fallback={<p role="status">Opening video studio…</p>}><VideoGenerator/></Suspense>;}
