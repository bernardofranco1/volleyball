import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center bg-surface px-6 text-center">
      <div>
        <p className="text-sm font-medium uppercase tracking-wide text-score-dim">
          404
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          Page not found
        </h1>
        <p className="mt-2 text-sm text-score-dim">
          The page doesn&apos;t exist or you don&apos;t have access to it.
        </p>
        <Link
          href="/"
          className="mt-4 inline-block rounded-lg border border-border px-4 py-2 text-sm text-score-dim transition-colors hover:text-foreground"
        >
          Go home
        </Link>
      </div>
    </main>
  );
}
