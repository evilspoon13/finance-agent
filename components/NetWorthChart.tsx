import type { NetWorthPoint } from "@/lib/db/net-worth-history";
import { formatCents } from "@/lib/money";

/**
 * Net worth over time — a plain server-rendered SVG area/line chart (no client
 * JS, no chart library). Points come from the daily `net_worth_snapshots`
 * series; native <title> tooltips give per-point detail on hover.
 */

const W = 720; // viewBox units; the svg scales to its container
const H = 220;
const PAD = { top: 16, right: 12, bottom: 24, left: 64 };

function fmtDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Compact axis label: $12.3k / $1.2M. */
function fmtAxis(cents: number): string {
  const dollars = cents / 100;
  const abs = Math.abs(dollars);
  const sign = dollars < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}k`;
  return `${sign}$${Math.round(abs)}`;
}

export function NetWorthChart({ points }: { points: NetWorthPoint[] }) {
  const oldest = points[0];
  const newest = points[points.length - 1];
  if (!oldest || !newest) {
    return (
      <p className="py-6 text-center text-sm text-zinc-500">
        No history yet — a snapshot is recorded each day you sync or open this page. Check back tomorrow for your first
        trend line.
      </p>
    );
  }

  const values = points.map((p) => p.netWorthCents);
  const first = oldest.netWorthCents;
  const last = newest.netWorthCents;
  const changeCents = last - first;

  // Pad the value range by 5% so the line never hugs the frame; always include
  // zero-width ranges (a single point, or a perfectly flat series) gracefully.
  const rawMin = Math.min(...values, 0);
  const rawMax = Math.max(...values, 0);
  const span = rawMax - rawMin || Math.abs(rawMax) || 100;
  const min = rawMin - span * 0.05;
  const max = rawMax + span * 0.05;

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const y = (cents: number) => PAD.top + plotH - ((cents - min) / (max - min)) * plotH;

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.netWorthCents).toFixed(1)}`).join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)},${(PAD.top + plotH).toFixed(1)} L${x(0).toFixed(1)},${(
    PAD.top + plotH
  ).toFixed(1)} Z`;

  const ticks = [max, (max + min) / 2, min];
  const up = changeCents >= 0;
  const stroke = up ? "#10b981" : "#ef4444";

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-2xl font-semibold tabular-nums">{formatCents(last)}</span>
        <span className={`text-sm tabular-nums ${up ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
          {up ? "▲" : "▼"} {formatCents(Math.abs(changeCents))}
          {first !== 0 ? ` (${((changeCents / Math.abs(first)) * 100).toFixed(1)}%)` : ""}
        </span>
        <span className="text-xs text-zinc-400">
          since {fmtDay(oldest.day)} · {points.length} {points.length === 1 ? "snapshot" : "snapshots"}
        </span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="h-56 w-full" role="img" aria-label="Net worth over time">
        <defs>
          <linearGradient id="nwFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>

        {ticks.map((t, i) => (
          <g key={i}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(t)}
              y2={y(t)}
              className="stroke-zinc-200 dark:stroke-zinc-800"
              strokeWidth="1"
            />
            <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" className="fill-zinc-400 text-[11px]">
              {fmtAxis(t)}
            </text>
          </g>
        ))}

        <path d={area} fill="url(#nwFill)" />
        <path d={line} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

        {points.map((p, i) => (
          <circle key={p.day} cx={x(i)} cy={y(p.netWorthCents)} r={points.length > 60 ? 0 : 3} fill={stroke}>
            <title>{`${fmtDay(p.day)}: ${formatCents(p.netWorthCents)}`}</title>
          </circle>
        ))}

        <text x={PAD.left} y={H - 6} className="fill-zinc-400 text-[11px]">
          {fmtDay(oldest.day)}
        </text>
        {points.length > 1 ? (
          <text x={W - PAD.right} y={H - 6} textAnchor="end" className="fill-zinc-400 text-[11px]">
            {fmtDay(newest.day)}
          </text>
        ) : null}
      </svg>
    </div>
  );
}
