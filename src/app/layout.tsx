import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import { boardFontClassName } from "@/lib/board-fonts";
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
  // App-UI theme (brief §1.3); broadcast boards ignore this and use their own
  // colour tokens.
  const theme =
    (await cookies()).get("vbtheme")?.value === "light" ? "light" : "dark";
  // boardFontClassName only defines the --font-* variables the broadcast boards
  // resolve against; none of those faces are preloaded, so pages that never
  // render a board download nothing extra (spec/24 §9.5 F7).
  return (
    <html
      lang="en"
      data-theme={theme}
      className={`${geistSans.variable} ${geistMono.variable} ${boardFontClassName} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
