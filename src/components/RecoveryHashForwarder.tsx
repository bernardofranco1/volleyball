"use client";

// Safety net for email links (spec/23 addendum): when the Supabase project's
// Site URL points at the app ROOT (no /auth/set-password path allowlisted),
// verified links land on the homepage with the session tokens in the URL
// fragment. Forward them — fragment intact — to the set-password page.
// Renders nothing; runs once.
import { useEffect } from "react";

export function RecoveryHashForwarder() {
  useEffect(() => {
    const h = window.location.hash;
    if (
      h.includes("access_token=") &&
      (h.includes("type=recovery") || h.includes("type=invite"))
    ) {
      window.location.replace(`/auth/set-password${h}`);
    }
  }, []);
  return null;
}
