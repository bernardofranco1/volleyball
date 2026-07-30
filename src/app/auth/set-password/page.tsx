import { SetPasswordForm } from "./SetPasswordForm";

// Landing page for invitation / password-reset email links (spec/23 addendum).
// The email link verifies at Supabase and redirects here with session tokens
// in the URL fragment; the client form adopts them and lets the person choose
// their password. Public route by design — the tokens ARE the authentication.
export const dynamic = "force-dynamic";

export const metadata = { title: "Set your password" };

export default function SetPasswordPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-6 py-16">
      <SetPasswordForm />
    </main>
  );
}
