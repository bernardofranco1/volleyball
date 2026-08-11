// Guards the pool configuration that makes transactions possible at all.
//
// History: `max_pipeline: 0` was set to stop postgres.js pipelining onto a busy
// Supavisor connection (the 2026-07-30 production freeze). It also, silently,
// broke every single `db.transaction()` in the app — appending a scoring event,
// creating a competition, saving match officials, CSV import, tenant purge —
// because postgres.js evaluates the pipeline gate and the `onexecute` callback in
// one `&&` chain, and `onexecute` is what marks a `sql.begin()` connection as
// RESERVED. With 0 the chain short-circuits, the connection is never reserved,
// and the driver refuses the BEGIN.
//
// The failure mode is the dangerous kind: no startup warning, no type error, and
// the runtime error ("UNSAFE_TRANSACTION") surfaces as a generic 500 from
// whichever feature happened to need a transaction. Hence a test on the config
// itself rather than trusting a comment to survive the next edit.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(process.cwd(), "src/db/index.ts"), "utf8");

/**
 * The literal options object passed to postgres(), with comments excluded — the
 * file explains these settings at length, and matching prose instead of code
 * would make this test pass on a comment while the real option was wrong.
 */
function block(after: string): string {
  const start = source.indexOf(after);
  const open = source.indexOf("postgres(connectionString, {", start);
  const end = source.indexOf("}", open);
  return source
    .slice(open, end)
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("//"))
    .join("\n");
}

/** The read pool's literal options (comments excluded — prose must not pass). */
const readPool = block("const client =");
/** The transaction pool's literal options. */
const txPool = block("const txClient =");
/** Options shared by both pools, comments excluded. */
const sharedOpts = (() => {
  const start = source.indexOf("const SHARED = {");
  const end = source.indexOf("}", start);
  return source
    .slice(start, end)
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("//"))
    .join("\n");
})();

function optionValue(src: string, name: string): string | null {
  const m = new RegExp(`\\b${name}\\s*:\\s*([^,\\n]+)`).exec(src);
  return m ? m[1].trim() : null;
}

describe("read pool (src/db/index.ts)", () => {
  it("has pipelining disabled — Supavisor transaction mode cannot take it", () => {
    expect(Number(optionValue(readPool, "max_pipeline"))).toBe(0);
  });

  it("is bounded, so warm instances can't exhaust the pooler's budget", () => {
    const max = Number(optionValue(readPool, "max"));
    expect(max).toBeGreaterThan(1);
    expect(max).toBeLessThanOrEqual(10);
  });
});

describe("transaction pool (src/db/index.ts)", () => {
  it("uses exactly one connection — that is what makes BEGIN legal", () => {
    // postgres.js permits a raw BEGIN only when `max === 1` or the connection is
    // reserved, and reservation depends on the callback that max_pipeline: 0
    // short-circuits. One connection is the only combination that gives working
    // transactions AND no pipelining.
    expect(Number(optionValue(txPool, "max"))).toBe(1);
  });

  it("does NOT set max_pipeline to 0, which would break every transaction", () => {
    const v = optionValue(txPool, "max_pipeline");
    expect(v === null || Number(v) > 0).toBe(true);
  });
});

describe("shared options", () => {
  it("release idle sockets rather than holding them forever", () => {
    expect(Number(optionValue(sharedOpts, "idle_timeout"))).toBeGreaterThan(0);
  });

  it("disable prepared statements, which transaction pooling cannot keep", () => {
    expect(optionValue(sharedOpts, "prepare")).toBe("false");
  });

  it("still document why the split exists", () => {
    // The reasoning is the only thing stopping someone "simplifying" this back
    // into one pool and silently breaking scoring again.
    expect(source).toMatch(/Supavisor/i);
    expect(source).toMatch(/UNSAFE_TRANSACTION/);
    expect(source).toMatch(/never `Promise\.all`/);
  });
});
