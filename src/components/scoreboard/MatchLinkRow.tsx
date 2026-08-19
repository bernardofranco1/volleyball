"use client";

/**
 * One match on the public index (spec/38): the board link, plus a copy button
 * for each layout so a venue can be sent its URL without anyone transcribing a
 * match number down a phone line.
 */

import { useState } from "react";

const VARIANTS = [
  { key: "", label: "Board" },
  { key: "?layout=ushape", label: "U-shape" },
  { key: "?screen=stats", label: "Stats" },
] as const;

export function MatchLinkRow({ matchNo }: { matchNo: number }) {
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (suffix: string) => {
    const url = `${window.location.origin}/m/${matchNo}${suffix}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard blocked (insecure context, or an old venue browser): select
      // it instead so ctrl-C still works rather than failing silently.
      window.prompt("Copy this link", url);
    }
    setCopied(suffix);
    setTimeout(() => setCopied((c) => (c === suffix ? null : c)), 1500);
  };

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {VARIANTS.map((v) => (
        <button
          key={v.key}
          type="button"
          onClick={() => void copy(v.key)}
          className="rounded border border-border px-2 py-1 text-xs text-score-dim transition hover:border-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2"
          title={`Copy the ${v.label.toLowerCase()} link for match ${matchNo}`}
        >
          {copied === v.key ? "Copied" : v.label}
        </button>
      ))}
    </span>
  );
}
