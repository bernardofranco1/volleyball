// Self-hosted broadcast-board fonts (spec/24 §9.5 F7).
//
// The scoreboard route used to pull these four families from
// fonts.googleapis.com with a plain <link rel="stylesheet">. That is a
// render-blocking request to a third-party origin on the one surface where first
// paint matters most — a venue TV or projector, often on hotel/arena wifi, and
// behind two extra DNS+TLS handshakes (googleapis + gstatic). next/font fetches
// the files at build time and serves them from our own origin/CDN instead, and
// emits `font-display: swap` + preload headers.
//
// Why CSS variables rather than the real family names: next/font deliberately
// hashes the family it registers, so `font-family: 'Saira Condensed'` no longer
// resolves. Board themes (and each competition's stored `fontFamily`) name fonts
// in human form, so `boardFontStack()` maps a stored name onto the generated
// variable. That keeps the DB contract untouched — no migration of existing
// competition branding rows.
import {
  Anton,
  Archivo,
  Barlow_Condensed,
  Saira_Condensed,
} from "next/font/google";
import localFont from "next/font/local";

// Weights match what the old Google Fonts URL requested, so the boards render
// with the same range of weights they were designed against.
//
// `preload: false` on all four deliberately. next/font preloads every
// instantiated face, which meant a board fetching 11 woff2 files to render in
// one family — worse than the Google Fonts stylesheet it replaced, where the
// browser only fetched faces it actually used. With preload off the browser
// fetches a face when an element first uses it, i.e. Saira on a board and
// nothing at all on admin pages, and `display: swap` keeps first paint
// immediate.
const sairaCondensed = Saira_Condensed({
  subsets: ["latin"],
  weight: ["600", "700", "800", "900"],
  variable: "--font-saira-condensed",
  display: "swap",
  preload: false,
});

const barlowCondensed = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-barlow-condensed",
  display: "swap",
  preload: false,
});

const archivo = Archivo({
  subsets: ["latin"],
  weight: ["700", "800", "900"],
  variable: "--font-archivo",
  display: "swap",
  preload: false,
});

const anton = Anton({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-anton",
  display: "swap",
  preload: false,
});

// Ancorli — the FIVB venue-brand face for the VIS-fed official boards
// (spec/34). Supplied as a licensed TTF, so next/font/local rather than
// next/font/google; same preload-off reasoning as the four faces above.
const ancorli = localFont({
  src: "../fonts/Ancorli.ttf",
  variable: "--font-ancorli",
  display: "swap",
  preload: false,
});

/**
 * Class names that define the four board font variables. Applied to <html> in
 * the root layout, NOT to a wrapper on the scoreboard route: next/font emits
 * these as a CSS module, and when the only importer was the scoreboard page the
 * class names were rendered but their stylesheet never made it into that
 * route's CSS — the variables resolved to nothing, the whole font-family
 * declaration became invalid, and boards silently inherited Geist. Declaring
 * them at the root guarantees the definitions are present; `preload: false`
 * above is what keeps that from costing every other page a font download.
 */
export const boardFontClassName = [
  sairaCondensed.variable,
  barlowCondensed.variable,
  archivo.variable,
  anton.variable,
  ancorli.variable,
].join(" ");

// The name→variable mapping and `boardFontStack()` live in board-theme.ts: they
// are pure strings, and keeping them out of this module means the admin pages
// that resolve a theme don't import next/font and start preloading board fonts
// they never render.
