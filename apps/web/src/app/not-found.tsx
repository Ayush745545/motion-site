import Link from "next/link";
export default function NotFound() {
  return <main className="fallback-page"><p className="eyebrow">MOTION DNA AI · 404</p><h1>A frame is missing.</h1><p>This page does not exist in the studio.</p><Link className="button" href="/">Back to the workspace</Link></main>;
}
