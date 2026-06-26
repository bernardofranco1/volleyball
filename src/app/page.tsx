import Link from "next/link";

const DISCIPLINES = [
  "Beach",
  "Indoor",
  "Grass",
  "Light Volleyball",
] as const;

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-24 text-center">
      <div className="flex flex-col items-center gap-8 max-w-2xl">
        <span className="rounded-full border border-border px-4 py-1 text-xs uppercase tracking-widest text-score-dim">
          White-label scoring SaaS
        </span>

        <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight">
          Volleyball Scoring Platform
        </h1>

        <p className="text-lg text-score-dim leading-8">
          Multi-discipline, multi-tenant, real-time officiating for every form
          of the game.
        </p>

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
