import type { Metadata } from "next";
import Link from "next/link";
import { WorkflowList } from "@/components/WorkflowList";
import "./globals.css";

export const metadata: Metadata = { title: "RepeatOne", description: "Describe a browser task once, verify it, replay it." };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="app">
          <header className="topbar">
            <Link href="/" className="brand"><span className="brand-mark" aria-hidden /> RepeatOne</Link>
            <span className="hint">Local demo · not hardened for authenticated or third-party sites</span>
          </header>
          <nav className="sidebar" aria-label="Workflows"><WorkflowList /></nav>
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
