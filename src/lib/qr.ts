import QRCode from "qrcode";

// Server-only QR helpers. `qrcode` renders to an inline SVG string with no
// browser/canvas dependency, so it's safe in a Node-runtime Server Component.

/** Render `text` as an inline SVG string (square, transparent background). */
export async function qrSvg(text: string): Promise<string> {
  return QRCode.toString(text, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 1,
    color: { dark: "#000000ff", light: "#ffffffff" },
  });
}
