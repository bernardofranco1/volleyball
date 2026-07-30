import Link from "next/link";
import { redirect } from "next/navigation";
import { safeRedirect } from "@/lib/http";
import { maybeSessionDestination } from "@/lib/login-destination";
import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirectTo?: string }>;
}) {
  const { redirectTo } = await searchParams;

  // Already signed in → skip the form: honour redirectTo when present,
  // otherwise the same routing a fresh login would use.
  const destination = await maybeSessionDestination();
  if (destination) redirect(safeRedirect(redirectTo ?? "") || destination);

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface-raised p-8">
        <Link
          href="/"
          className="text-xs uppercase tracking-widest text-score-dim hover:text-foreground"
        >
          ← Volleyball Platform
        </Link>

        <h1 className="mt-4 mb-1 text-2xl font-semibold tracking-tight">
          Sign in
        </h1>
        <p className="mb-6 text-sm text-score-dim">
          Access your tenant dashboard.
        </p>

        <LoginForm redirectTo={redirectTo ?? ""} />
      </div>
    </main>
  );
}
