import { Suspense } from "react";
import { MotionEditor } from "@/components/motion-editor";

export default function StudioPage() {
  return <Suspense fallback={<div className="editor-loading" role="status">Opening your studio…</div>}><MotionEditor/></Suspense>;
}
