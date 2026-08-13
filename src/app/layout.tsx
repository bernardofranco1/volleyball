import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import { boardFontClassName } from "@/lib/board-fonts";
import { ImpersonationBanner } from "@/components/ImpersonationBanner";
import { EnvironmentBanner } from "@/components/EnvironmentBanner";
import { DB_SCHEMA, IS_PROD_SCHEMA } from "@/db/env";
import { IMPERSONATION_COOKIE } from "@/lib/impersonation";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Volleyball Scoring Platform",
  description:
    "White-label multi-discipline volleyball scoring — beach, indoor, grass, and light volleyball.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  // App-UI theme (brief §1.3); broadcast boards ignore this and use their own
  // colour tokens.
  const theme = cookieStore.get("vbtheme")?.value === "light" ? "light" : "dark";

  // "Sign in as…" banner (spec/26 §7). Cheap presence probe first: this layout
  // wraps every route including public boards and the login page, and must not
  // start paying for auth + DB on the 99.9% of requests with no overlay.
  const impersonation = cookieStore.has(IMPERSONATION_COOKIE)
    ? await (await import("@/lib/authz")).getImpersonation()
    : null;
  // boardFontClassName only defines the --font-* variables the broadcast boards
  // resolve against; none of those faces are preloaded, so pages that never
  // render a board download nothing extra (spec/24 §9.5 F7).
  return (
    <html
      lang="en"
      data-theme={theme}
      // Drives the padding that keeps the homologation banner from covering
      // page chrome; absent (and free) in production.
      data-env={IS_PROD_SCHEMA ? undefined : DB_SCHEMA}
      className={`${geistSans.variable} ${geistMono.variable} ${boardFontClassName} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        {/* Renders only when this build is NOT pointed at production tables. */}
        <EnvironmentBanner />
        {impersonation && (
          <ImpersonationBanner
            targetEmail={impersonation.target.email}
            expiresAt={impersonation.expiresAt}
          />
        )}
      </body>
    </html>
  );
}
