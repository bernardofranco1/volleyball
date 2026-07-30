"use client";

// Lets an invited person choose their password. Three entry modes:
//   1. ?token_hash=…&type=… — OUR email links (scanner-safe): the one-time
//      token is verified ONLY when the person presses submit, so corporate
//      mail scanners that pre-fetch (or render) the link can't consume it
//      (Microsoft Safe Links burned a fresh invite on 2026-07-30).
//   2. #access_token=…&refresh_token=… — links sent by Supabase's own mailer
//      (the no-SMTP fallback), which verify at GoTrue before landing here.
//   3. ?code=… — same-browser PKCE.
// Deterministic manual handling — no reliance on detectSessionInUrl.
import { useEffect, useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { ui } from "@/components/admin/styles";

type Phase = "adopting" | "ready" | "invalid" | "saving" | "done";

export function SetPasswordForm() {
  const [phase, setPhase] = useState<Phase>("adopting");
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  // Set in mode 1 — consumed (verifyOtp) on submit, never on load.
  const pendingToken = useRef<{ tokenHash: string; type: "recovery" | "invite" } | null>(null);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    const run = async () => {
      const query = new URLSearchParams(window.location.search);
      const hash = new URLSearchParams(window.location.hash.slice(1));

      const tokenHash = query.get("token_hash");
      const type = query.get("type");
      if (tokenHash && (type === "recovery" || type === "invite")) {
        // Do NOT verify yet — that would make the link scanner-consumable.
        pendingToken.current = { tokenHash, type };
        return setPhase("ready");
      }

      const accessToken = hash.get("access_token");
      const refreshToken = hash.get("refresh_token");
      if (accessToken && refreshToken) {
        const { error: e } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (e) return setPhase("invalid");
        // Tokens out of the address bar (history, screenshots).
        window.history.replaceState(null, "", window.location.pathname);
        return setPhase("ready");
      }
      const code = query.get("code");
      if (code) {
        const { error: e } = await supabase.auth.exchangeCodeForSession(code);
        if (e) return setPhase("invalid");
        window.history.replaceState(null, "", window.location.pathname);
        return setPhase("ready");
      }
      // Direct navigation with an existing session is also fine (password change).
      const { data } = await supabase.auth.getUser();
      setPhase(data.user ? "ready" : "invalid");
    };
    void run();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8)
      return setError("Password must be at least 8 characters.");
    if (password !== confirm) return setError("Passwords don't match.");
    setPhase("saving");
    const supabase = createSupabaseBrowserClient();

    // Mode 1: consume the one-time token now — a human pressed the button.
    if (pendingToken.current) {
      const { error: ve } = await supabase.auth.verifyOtp({
        type: pendingToken.current.type,
        token_hash: pendingToken.current.tokenHash,
      });
      if (ve) {
        setPhase("invalid");
        return;
      }
      pendingToken.current = null;
      window.history.replaceState(null, "", window.location.pathname);
    }

    const { error: e2 } = await supabase.auth.updateUser({ password });
    if (e2) {
      setPhase("ready");
      return setError(e2.message);
    }
    setPhase("done");
    // /select-tenant routes to the right place (dashboard / picker / console).
    window.location.href = "/select-tenant";
  };

  if (phase === "adopting") {
    return <p className="text-sm text-score-dim">Checking your link…</p>;
  }
  if (phase === "invalid") {
    return (
      <div className={ui.card}>
        <h1 className="mb-2 text-xl font-semibold">Link expired or invalid</h1>
        <p className="text-sm text-score-dim">
          Ask your administrator to send a new password email, or use the
          temporary password they gave you on the{" "}
          <a href="/login" className="text-primary underline">
            sign-in page
          </a>
          .
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className={ui.card}>
      <h1 className="mb-1 text-xl font-semibold">Choose your password</h1>
      <p className="mb-4 text-sm text-score-dim">
        You&apos;ll use it together with your email address to sign in.
      </p>
      <div className="space-y-3">
        <div>
          <label className={ui.label} htmlFor="sp-password">
            New password
          </label>
          <input
            id="sp-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={ui.input}
          />
        </div>
        <div>
          <label className={ui.label} htmlFor="sp-confirm">
            Repeat password
          </label>
          <input
            id="sp-confirm"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className={ui.input}
          />
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={phase === "saving" || phase === "done"}
          className={ui.btnPrimary}
        >
          {phase === "saving" || phase === "done" ? "Saving…" : "Set password & sign in"}
        </button>
      </div>
    </form>
  );
}
