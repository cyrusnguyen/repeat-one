import Link from "next/link";
import { Plus, ShieldCheck } from "lucide-react";

export default function Home() {
  return (
    <div className="page">
      <div className="empty">
        <h1>Describe a browser task once. Verify it. Run it again.</h1>
        <p>Opus inspects the real page and proposes steps. You approve them, Playwright runs them, and every run is checked and kept.</p>
        <Link className="btn primary" href="/workflows/new"><Plus aria-hidden /> Create a workflow</Link>
        <p className="callout info" style={{ maxWidth: 560, textAlign: "left" }}>
          <ShieldCheck aria-hidden />
          <span>This is a local, single-user demo. The browser can only load allowlisted URLs and blocks destructive actions, but it has not been reviewed for automating authenticated or third-party sites.</span>
        </p>
      </div>
    </div>
  );
}
