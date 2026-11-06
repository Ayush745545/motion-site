import Link from "next/link";
import { ArrowUpRight, Clapperboard, Plus, ScanLine, Sparkles, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import "./dashboard-hero.css";

export function DashboardHero({ projectId }: { projectId: string | undefined }) {
  const projectQuery = projectId ? `?project=${projectId}` : "";
  const shortcuts = [
    { label: "Create", href: "/create", icon: Plus },
    { label: "Studio", href: `/studio${projectQuery}`, icon: Clapperboard },
    { label: "DNA Analysis", href: `/analysis${projectQuery}`, icon: ScanLine },
    { label: "Local Render", href: "/queue", icon: Video },
  ];

  return (
    <section className="dashboard-intro" aria-labelledby="dashboard-intro-title">
      <h1 id="dashboard-intro-title">
        Run your motion studio <span className="dashboard-intro-highlight">75% faster</span> with AI
      </h1>
      <p>
        Extract brand visual DNA, orchestrate kinetic typography, and render local MP4 videos.
        <br className="dashboard-intro-break" /> Your entire creative workflow, in one workspace.
      </p>
      <div className="dashboard-intro-actions">
        <Button asChild className="dashboard-intro-primary">
          <Link href="/create">Get started <Sparkles size={20} aria-hidden="true" /></Link>
        </Button>
        <Button asChild variant="outline" className="dashboard-intro-secondary">
          <Link href={`/studio${projectQuery}`}>Open studio <ArrowUpRight size={18} aria-hidden="true" /></Link>
        </Button>
      </div>
      <nav className="dashboard-shortcuts" aria-label="Studio quick actions">
        {shortcuts.map(({ label, href, icon: Icon }, index) => (
          <Link key={label} href={href} className={index === 0 ? "shortcut-featured" : undefined}>
            <Icon size={19} aria-hidden="true" />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
    </section>
  );
}
