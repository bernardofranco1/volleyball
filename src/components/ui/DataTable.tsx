import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The console's table primitive. Everything you scan — matches, schedule,
 * people, competitions, audit — renders through this, so row height, header
 * treatment, group separators and empty states are decided once.
 *
 * Deliberately a server component: sorting and filtering are URL state, which
 * means a sorted view is linkable, survives a reload, and costs no client
 * JavaScript. The only interactive pieces that need a client are row selection
 * and inline editing, and those are separate islands that compose into a cell.
 */

export type Align = "left" | "right" | "center";

export interface Column<T> {
  /** Stable key — also the React key for the cell. */
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: Align;
  /** Tailwind width class, e.g. "w-24". Columns are otherwise content-sized. */
  width?: string;
  /** Extra classes applied to both header and cells (e.g. responsive hiding). */
  className?: string;
  /**
   * When set, the header renders as a sort toggle writing `?sort=<key>` /
   * `?sort=<key>:desc` into the URL. The page decides what those mean.
   */
  sortKey?: string;
}

export interface RowGroup<T> {
  key: string;
  /** Group separator row; omit for a single ungrouped block. */
  label?: ReactNode;
  rows: T[];
}

const ALIGN: Record<Align, string> = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
};

export type Density = "compact" | "cozy" | "comfortable";

/**
 * Header cell. Sortable headers are links, so the sorted view is a URL — the
 * `sortParams` callback belongs to the page because only it knows which other
 * params must survive the click.
 */
function HeaderCell<T>({
  col,
  sortHref,
  currentSort,
}: {
  col: Column<T>;
  sortHref?: (key: string, desc: boolean) => string;
  currentSort?: string;
}) {
  const cls = `px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.09em] text-score-dim ${
    ALIGN[col.align ?? "left"]
  } ${col.width ?? ""} ${col.className ?? ""}`;

  if (!col.sortKey || !sortHref) {
    return (
      <th scope="col" className={cls}>
        {col.header}
      </th>
    );
  }

  const [active, dir] = (currentSort ?? "").split(":");
  const isActive = active === col.sortKey;
  const nextDesc = isActive && dir !== "desc";
  return (
    <th
      scope="col"
      className={cls}
      aria-sort={
        isActive ? (dir === "desc" ? "descending" : "ascending") : undefined
      }
    >
      <Link
        href={sortHref(col.sortKey, nextDesc)}
        className={`inline-flex items-center gap-1 transition-colors hover:text-foreground ${
          isActive ? "text-foreground" : ""
        }`}
      >
        {col.header}
        <span aria-hidden className={isActive ? "" : "opacity-0"}>
          {dir === "desc" ? "↓" : "↑"}
        </span>
      </Link>
    </th>
  );
}

export function DataTable<T>({
  columns,
  groups,
  rowKey,
  density = "cozy",
  empty,
  sortHref,
  currentSort,
  rowClassName,
  footer,
}: {
  columns: Column<T>[];
  groups: RowGroup<T>[];
  rowKey: (row: T) => string;
  density?: Density;
  /** Shown in place of the table body when there are no rows at all. */
  empty?: ReactNode;
  sortHref?: (key: string, desc: boolean) => string;
  currentSort?: string;
  rowClassName?: (row: T) => string;
  /** Pagination / totals strip rendered inside the table's border. */
  footer?: ReactNode;
}) {
  const total = groups.reduce((n, g) => n + g.rows.length, 0);

  return (
    <div
      data-density={density}
      className="overflow-hidden rounded-xl border border-border bg-surface-raised"
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[52rem] border-collapse">
          <thead className="bg-surface-3">
            <tr>
              {columns.map((c) => (
                <HeaderCell
                  key={c.key}
                  col={c}
                  sortHref={sortHref}
                  currentSort={currentSort}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {total === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-10 text-center text-sm text-score-dim"
                >
                  {empty}
                </td>
              </tr>
            ) : (
              groups.map((g) => (
                <GroupBlock
                  key={g.key}
                  group={g}
                  columns={columns}
                  rowKey={rowKey}
                  rowClassName={rowClassName}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
      {footer && (
        <div className="border-t border-border px-3 py-2 text-xs text-score-dim">
          {footer}
        </div>
      )}
    </div>
  );
}

function GroupBlock<T>({
  group,
  columns,
  rowKey,
  rowClassName,
}: {
  group: RowGroup<T>;
  columns: Column<T>[];
  rowKey: (row: T) => string;
  rowClassName?: (row: T) => string;
}) {
  return (
    <>
      {group.label && (
        <tr>
          <th
            scope="colgroup"
            colSpan={columns.length}
            className="border-y border-border bg-surface-3 px-3 py-1.5 text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-score-dim"
          >
            {group.label}
          </th>
        </tr>
      )}
      {group.rows.map((row) => (
        <tr
          key={rowKey(row)}
          className={`border-b border-border last:border-b-0 transition-colors hover:bg-surface-hover ${
            rowClassName?.(row) ?? ""
          }`}
        >
          {columns.map((c) => (
            <td
              key={c.key}
              // Row height comes from the density token, so one attribute on
              // the wrapper retunes every row (see globals.css [data-density]).
              style={{ paddingTop: "var(--row-py)", paddingBottom: "var(--row-py)" }}
              className={`px-3 align-middle text-sm ${ALIGN[c.align ?? "left"]} ${
                c.width ?? ""
              } ${c.className ?? ""}`}
            >
              {c.cell(row)}
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
