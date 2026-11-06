import type { Metadata } from "next";
import { getServerEnv } from "@motion-dna/config";
import { AppShell } from "@/components/app-shell";
import { WorkspaceProvider } from "@/lib/workspace";
import "./globals.css";
import "./saas-theme.css";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Motion DNA AI — Your local motion studio",
  description: "A local motion design studio for website references, source code, and editable composition drafts.",
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const { API_BASE_URL } = getServerEnv();
  return <html lang="en" className="dark"><body><WorkspaceProvider><AppShell apiDocsUrl={`${API_BASE_URL}/docs`}>{children}</AppShell></WorkspaceProvider></body></html>;
}
