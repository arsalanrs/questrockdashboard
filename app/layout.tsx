import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "LO Command Center",
  description: "Internal operations dashboard (read-only)",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}

