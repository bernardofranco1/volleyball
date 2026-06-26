import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PDFKit reads its AFM font metrics from disk at runtime via __dirname. Keep it
  // as a runtime require (not bundled) so those paths resolve under node_modules
  // in the nodejs route runtime (see src/app/api/matches/[id]/export.pdf).
  serverExternalPackages: ["pdfkit"],
};

export default nextConfig;
