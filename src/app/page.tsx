import Link from "next/link";
import { redirect } from "next/navigation";
import { RecoveryHashForwarder } from "@/components/RecoveryHashForwarder";
import { maybeSessionDestination } from "@/lib/login-destination";

const DISCIPLINES = [
  "Beach",
  "Indoor",
  "Grass",
  "Light Volleyball",
] as const;

export default async function Home() {
  // A signed-in visitor belongs in the app, not on the marketing page —
  // route them exactly where a fresh login would. Anonymous visitors (no
  // auth cookie) skip the check entirely and get the static page.
  const destination = await maybeSessionDestination();
  if (destination) redirect(destination);

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-24 text-center">
      {/* Email-link safety net: forwards #access_token recovery fragments. */}
      <RecoveryHashForwarder />
      <div className="flex flex-col items-center gap-8 max-w-2xl">
        <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight">
          Volleyball Scoring Platform
        </h1>

        <ul className="flex flex-wrap items-center justify-center gap-3">
          {DISCIPLINES.map((d) => (
            <li
              key={d}
              className="rounded-lg border border-border bg-surface-raised px-4 py-2 text-sm"
            >
              {d}
            </li>
          ))}
        </ul>

        <Link
          href="/login"
          className="mt-2 inline-flex h-12 items-center justify-center rounded-full bg-primary px-8 font-medium text-primary-fg transition-opacity hover:opacity-90"
        >
          Sign in
        </Link>
      </div>
    </main>
  );
}
