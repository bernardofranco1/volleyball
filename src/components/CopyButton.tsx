"use client";

import { useEffect, useState } from "react";

/** Copies `text` to the clipboard with a brief "Copied ✓" confirmation. */
export function CopyButton({
  text,
  label = "Copy link",
  className,
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <button
      type="button"
      className={
        className ?? "text-xs text-score-dim underline hover:text-foreground"
      }
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
        } catch {
          // Clipboard unavailable (http / permissions) — select-able fallback.
          window.prompt("Copy the link:", text);
        }
      }}
    >
      {copied ? "Copied ✓" : label}
    </button>
  );
}
