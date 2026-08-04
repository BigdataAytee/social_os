"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { PlatformSeries } from "@/modules/analytics/service";
import { studioForPlatform } from "@/lib/studios";
import { formatCompact } from "@/lib/utils";

/**
 * Every chart in SocialOS renders through here, and every one of them reads
 * AnalyticsSnapshot rows (§12) — none are hardcoded.
 *
 * Colors come from the Studio registry, so a series is always the same color as
 * its Studio's dot in the sidebar.
 */

type Metric = "followers" | "reach" | "engagement" | "impressions" | "clicks";

const METRIC_LABELS: Record<Metric, string> = {
  followers: "Followers",
  reach: "Reach",
  engagement: "Engagement",
  impressions: "Impressions",
  clicks: "Clicks",
};

function accentFor(series: PlatformSeries) {
  return `rgb(var(${studioForPlatform(series.platform).accentVar}))`;
}

const axisProps = {
  stroke: "rgb(var(--text-muted))",
  fontSize: 11,
  tickLine: false,
  axisLine: false,
  style: { fontFamily: "var(--font-mono)" },
} as const;

function ChartTooltip({
  active,
  payload,
  label,
  normalize = false,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number; color?: string }[];
  label?: string;
  normalize?: boolean;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-border bg-surface-raised px-3 py-2 shadow-lg shadow-black/40">
      <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-muted">
        {label}
      </p>
      {payload.map((entry) => (
        <p
          key={entry.name}
          className="flex items-center gap-2 font-mono text-xs tabular text-primary"
        >
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          {entry.name}
          <span className="ml-auto">
            {normalize
              ? `${(entry.value ?? 0) >= 100 ? "+" : ""}${((entry.value ?? 0) - 100).toFixed(1)}%`
              : formatCompact(entry.value ?? 0)}
          </span>
        </p>
      ))}
    </div>
  );
}

/**
 * Multi-platform comparison — one line per connected account.
 *
 * `normalize` indexes every series to 100 at the start of the window. Use it
 * for level metrics like followers: platforms differ by an order of magnitude,
 * so a shared absolute axis flattens every line into a straight streak and
 * hides the growth the chart exists to show. Flows (reach, engagement) are
 * comparable in absolute terms and should stay un-normalized.
 */
export function MultiSeriesChart({
  series,
  metric,
  height = 260,
  normalize = false,
}: {
  series: PlatformSeries[];
  metric: Metric;
  height?: number;
  normalize?: boolean;
}) {
  // Recharts wants one row per x value with a key per line, so pivot the
  // per-account point lists into a single date-keyed table.
  const byDate = new Map<string, Record<string, number | string>>();
  for (const s of series) {
    const label = studioForPlatform(s.platform).label;
    const base = s.points[0]?.[metric] ?? 0;
    for (const point of s.points) {
      const row = byDate.get(point.date) ?? { date: point.date };
      row[label] =
        normalize && base > 0 ? (point[metric] / base) * 100 : point[metric];
      byDate.set(point.date, row);
    }
  }
  const data = [...byDate.values()].sort((a, b) =>
    String(a.date).localeCompare(String(b.date))
  );

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
        <CartesianGrid stroke="rgb(var(--border))" vertical={false} />
        <XAxis dataKey="date" {...axisProps} minTickGap={32} />
        <YAxis
          {...axisProps}
          domain={normalize ? ["auto", "auto"] : [0, "auto"]}
          tickFormatter={(v) =>
            normalize ? `${Number(v).toFixed(0)}` : formatCompact(Number(v))
          }
        />
        <Tooltip content={<ChartTooltip normalize={normalize} />} />
        <Legend
          iconType="circle"
          iconSize={7}
          wrapperStyle={{
            fontSize: 11,
            fontFamily: "var(--font-sans)",
            color: "rgb(var(--text-secondary))",
          }}
        />
        {series.map((s) => (
          <Line
            key={s.platform}
            type="monotone"
            dataKey={studioForPlatform(s.platform).label}
            stroke={accentFor(s)}
            strokeWidth={1.75}
            dot={false}
            activeDot={{ r: 3 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Single-platform area, used inside a Studio's Analytics tab. */
export function SingleSeriesChart({
  series,
  metric,
  height = 240,
}: {
  series: PlatformSeries;
  metric: Metric;
  height?: number;
}) {
  const color = accentFor(series);
  const gradientId = `grad-${series.platform}-${metric}`;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart
        data={series.points}
        margin={{ top: 8, right: 8, bottom: 0, left: -12 }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.28} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="rgb(var(--border))" vertical={false} />
        <XAxis dataKey="date" {...axisProps} minTickGap={32} />
        <YAxis {...axisProps} tickFormatter={(v) => formatCompact(Number(v))} />
        <Tooltip content={<ChartTooltip />} />
        <Area
          type="monotone"
          dataKey={metric}
          name={METRIC_LABELS[metric]}
          stroke={color}
          strokeWidth={1.75}
          fill={`url(#${gradientId})`}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export { METRIC_LABELS, type Metric };
