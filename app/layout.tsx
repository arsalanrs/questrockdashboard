import "./globals.css";
import type { Metadata } from "next";
import { ThemeScript } from "@/components/ThemeScript";

export const metadata: Metadata = {
  title: "LO Command Center",
  description: "Internal operations dashboard (read-only)",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
