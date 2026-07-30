"use client";

// Adopts the session tokens delivered by a Supabase email link (URL fragment
// `#access_token=…&refresh_token=…`, or `?code=` for same-browser PKCE), then
// lets the person set their password. Deterministic manual handling — no
// reliance on detectSessionInUrl, which varies by flow type.
import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { ui } from "@/components/admin/styles";

type Phase = "adopting" | "ready" | "invalid" | "saving" | "done";

export function SetPasswordForm() {
  const [phase, setPhase] = useState<Phase>("adopting");
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    const run = async () => {
      const hash = new URLSearchParams(window.location.hash.slice(1));
      const accessToken = hash.get("access_token");
      const refreshToken = hash.get("refresh_token");
      const code = new URLSearchParams(window.location.search).get("code");

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
