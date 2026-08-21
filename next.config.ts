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
  // The TV overlay (spec/47) plays an arbitrary operator-supplied stream under
  // its graphics. Without media-src that falls through to default-src 'self'
  // and the video is blocked outright — the manifest and segments are fetched
  // by XHR, which connect-src already allows, so the failure looks like a
  // silent black frame rather than a network error. blob: is hls.js: it feeds
  // the <video> element through a MediaSource object URL, not the https URL.
  "media-src 'self' blob: https:",
  // hls.js parses the transport stream in a worker it spawns from a blob.
  "worker-src 'self' blob:",
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
  serverExternalPackages: ["pdfkit", "nodemailer"],
  // The email templates are runtime-read config files (config/emails/) — make
  // sure output file tracing ships them with every serverless function.
  outputFileTracingIncludes: {
    "**": ["./config/emails/**"],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
