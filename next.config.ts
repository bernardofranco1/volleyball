import type { NextConfig } from "next";

// Content-Security-Policy tuned to what the app actually loads:
//  - Google Fonts (scoreboard) → style/font hosts
//  - Supabase realtime (wss) + Sentry + tenant logo images (arbitrary https)
//  - Next.js injects inline bootstrap scripts/styles → 'unsafe-inline'
// Kept deliberately non-breaking; tighten with nonces in a later pass.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https: wss:",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
];

const nextConfig: NextConfig = {
  // PDFKit reads its AFM font metrics from disk at runtime via __dirname. Keep it
  // as a runtime require (not bundled) so those paths resolve under node_modules
  // in the nodejs route runtime (see src/app/api/matches/[id]/export.pdf).
  serverExternalPackages: ["pdfkit"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
