import { Suspense } from "react";
import { DNAAnalysis } from "@/components/dna-analysis";

export default function AnalysisPage() {
  return <Suspense fallback={<div className="editor-loading" role="status">Opening project DNA…</div>}><DNAAnalysis/></Suspense>;
}
