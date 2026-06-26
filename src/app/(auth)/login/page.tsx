import Link from "next/link";
import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirectTo?: string }>;
}) {
  const { redirectTo } = await searchParams;

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
