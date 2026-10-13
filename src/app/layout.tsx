import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "RepeatOne", description: "Describe a browser task once, verify it, replay it." };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
