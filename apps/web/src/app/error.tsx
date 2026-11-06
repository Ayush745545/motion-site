"use client";
import { useEffect } from "react";
import { Button } from "@motion-dna/ui";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(JSON.stringify({ level: "error", event: "web_render_failed", digest: error.digest ?? null }));
  }, [error]);
  return <main className="fallback-page"><p className="eyebrow">MOTION DNA AI</p><h1>The studio hit a pause.</h1><p>Something interrupted this page. Try loading the workspace again.</p><Button onClick={reset}>Try again</Button></main>;
}
