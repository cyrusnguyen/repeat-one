import Link from "next/link";
import { Fragment } from "react";
import { DemoVariantSelect } from "./DemoVariantSelect";

export type Crumb = { label: string; href?: string };

export function TopBar({ crumbs = [], children }: { crumbs?: Crumb[]; children?: React.ReactNode }) {
  return (
    <header className="topbar">
      <Link href="/" className="logo"><i aria-hidden />RepeatOne</Link>
      <nav className="crumbs" aria-label="Breadcrumb">
        {crumbs.map((c, i) => (
          <Fragment key={i}>
            <span className="sep" aria-hidden>/</span>
            {c.href ? <Link href={c.href}>{c.label}</Link> : <span aria-current="page">{c.label}</span>}
          </Fragment>
        ))}
      </nav>
      <span className="spacer" />
      <DemoVariantSelect />
      {children}
    </header>
  );
}
