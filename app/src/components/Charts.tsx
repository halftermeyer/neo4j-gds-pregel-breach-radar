// Hand-rolled SVG charts (no chart library): line chart with optional log axis, and a scatter plot.
import type { ReactNode } from "react";

export interface Series {
  name: string;
  color: string;
  points: { x: number; y: number }[];
  dashed?: boolean;
  width?: number;
  dots?: boolean;
}

interface LineProps {
  series: Series[];
  width?: number;
  height?: number;
  xLabel?: string;
  yLabel?: string;
  logY?: boolean;
  yMin?: number;
  yMax?: number;
  xMin?: number;
  xMax?: number;
  xTicks?: number[];
  xFormat?: (x: number) => string;
  yFormat?: (y: number) => string;
  markerX?: number;
  hLine?: { y: number; label: string };
  legend?: boolean;
  empty?: string;
}

const M = { l: 54, r: 14, t: 12, b: 40 };

function niceTicks(lo: number, hi: number, n = 5): number[] {
  const span = hi - lo || 1;
  const raw = span / n;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

export function LineChart(p: LineProps) {
  const W = p.width ?? 640;
  const H = p.height ?? 280;
  const all = p.series.flatMap((s) => s.points);
  if (all.length === 0) return <div className="chart-empty">{p.empty ?? "No data yet"}</div>;
  const xs = all.map((a) => a.x);
  const x0 = p.xMin ?? Math.min(...xs);
  const x1 = p.xMax ?? Math.max(...xs);
  const ys = all.map((a) => a.y).filter((y) => (p.logY ? y > 0 : true));
  let y0 = p.yMin ?? Math.min(...ys);
  let y1 = p.yMax ?? Math.max(...ys);
  if (p.logY) {
    y0 = Math.pow(10, Math.floor(Math.log10(y0)));
    y1 = Math.pow(10, Math.ceil(Math.log10(y1)));
    if (y0 === y1) y1 = y0 * 10;
  } else if (y0 === y1) y1 = y0 + 1;
  const iw = W - M.l - M.r;
  const ih = H - M.t - M.b;
  const sx = (x: number) => M.l + (x1 === x0 ? iw / 2 : ((x - x0) / (x1 - x0)) * iw);
  const sy = (y: number) => {
    if (p.logY) return M.t + ih - ((Math.log10(Math.max(y, y0)) - Math.log10(y0)) / (Math.log10(y1) - Math.log10(y0))) * ih;
    return M.t + ih - ((y - y0) / (y1 - y0)) * ih;
  };
  const yTicks = p.logY
    ? Array.from({ length: Math.round(Math.log10(y1 / y0)) + 1 }, (_, i) => y0 * Math.pow(10, i))
    : niceTicks(y0, y1, 5);
  const xTicks = p.xTicks ?? niceTicks(x0, x1, 6);
  const fx = p.xFormat ?? ((x: number) => String(x));
  const fy = p.yFormat ?? ((y: number) => (p.logY ? y.toExponential(0) : String(+y.toFixed(3))));
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img">
        {yTicks.map((t) => (
          <g key={`y${t}`}>
            <line x1={M.l} x2={W - M.r} y1={sy(t)} y2={sy(t)} className="grid" />
            <text x={M.l - 6} y={sy(t) + 4} className="tick" textAnchor="end">{fy(t)}</text>
          </g>
        ))}
        {xTicks.map((t) => (
          <g key={`x${t}`}>
            <line x1={sx(t)} x2={sx(t)} y1={M.t} y2={M.t + ih} className="grid v" />
            <text x={sx(t)} y={H - M.b + 16} className="tick" textAnchor="middle">{fx(t)}</text>
          </g>
        ))}
        <line x1={M.l} x2={W - M.r} y1={M.t + ih} y2={M.t + ih} className="axis" />
        <line x1={M.l} x2={M.l} y1={M.t} y2={M.t + ih} className="axis" />
        {p.hLine && (
          <g>
            <line x1={M.l} x2={W - M.r} y1={sy(p.hLine.y)} y2={sy(p.hLine.y)} className="hline" />
            <text x={W - M.r - 4} y={sy(p.hLine.y) - 5} className="tick" textAnchor="end">{p.hLine.label}</text>
          </g>
        )}
        {p.markerX !== undefined && <line x1={sx(p.markerX)} x2={sx(p.markerX)} y1={M.t} y2={M.t + ih} className="marker" />}
        {p.series.map((s) => (
          <g key={s.name}>
            <polyline
              fill="none"
              stroke={s.color}
              strokeWidth={s.width ?? 2.4}
              strokeDasharray={s.dashed ? "6 4" : undefined}
              strokeLinejoin="round"
              points={s.points.map((q) => `${sx(q.x)},${sy(q.y)}`).join(" ")}
            />
            {(s.dots ?? s.points.length < 24) && s.points.map((q, i) => <circle key={i} cx={sx(q.x)} cy={sy(q.y)} r={3.2} fill={s.color} />)}
          </g>
        ))}
        {p.xLabel && <text x={M.l + iw / 2} y={H - 4} className="axis-label" textAnchor="middle">{p.xLabel}</text>}
        {p.yLabel && (
          <text transform={`translate(12 ${M.t + ih / 2}) rotate(-90)`} className="axis-label" textAnchor="middle">{p.yLabel}</text>
        )}
      </svg>
      {(p.legend ?? true) && p.series.length > 1 && (
        <div className="chart-legend">
          {p.series.map((s) => (
            <span key={s.name}><i style={{ background: s.color }} />{s.name}</span>
          ))}
        </div>
      )}
    </div>
  );
}

export interface Dot {
  x: number;
  y: number;
  color: string;
  r?: number;
  title?: string;
  ring?: boolean;
}

export function Scatter(p: { dots: Dot[]; width?: number; height?: number; xLabel: string; yLabel: string; logX?: boolean; extra?: ReactNode }) {
  const W = p.width ?? 560;
  const H = p.height ?? 340;
  if (p.dots.length === 0) return <div className="chart-empty">No data yet</div>;
  const xv = p.dots.map((d) => d.x);
  const yv = p.dots.map((d) => d.y);
  const xmax = Math.max(...xv) * 1.05;
  const xmin = p.logX ? Math.max(1, Math.min(...xv)) * 0.9 : 0;
  const ymax = Math.max(...yv) * 1.08;
  const iw = W - M.l - M.r;
  const ih = H - M.t - M.b;
  const sx = (x: number) => M.l + (p.logX ? (Math.log10(x / xmin) / Math.log10(xmax / xmin)) * iw : ((x - xmin) / (xmax - xmin)) * iw);
  const sy = (y: number) => M.t + ih - (y / ymax) * ih;
  const yt = niceTicks(0, ymax, 5);
  const xt = p.logX ? [1, 10, 100, 1000].filter((t) => t >= xmin && t <= xmax) : niceTicks(0, xmax, 6);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img">
      {yt.map((t) => (
        <g key={`y${t}`}>
          <line x1={M.l} x2={W - M.r} y1={sy(t)} y2={sy(t)} className="grid" />
          <text x={M.l - 6} y={sy(t) + 4} className="tick" textAnchor="end">{t}</text>
        </g>
      ))}
      {xt.map((t) => (
        <text key={`x${t}`} x={sx(t)} y={H - M.b + 16} className="tick" textAnchor="middle">{t}</text>
      ))}
      <line x1={M.l} x2={W - M.r} y1={M.t + ih} y2={M.t + ih} className="axis" />
      <line x1={M.l} x2={M.l} y1={M.t} y2={M.t + ih} className="axis" />
      {p.dots.map((d, i) => (
        <circle key={i} cx={sx(d.x)} cy={sy(d.y)} r={d.r ?? 3} fill={d.ring ? "none" : d.color} stroke={d.color} strokeWidth={d.ring ? 2 : 0.5} opacity={d.ring ? 1 : 0.75}>
          {d.title && <title>{d.title}</title>}
        </circle>
      ))}
      {p.extra}
      <text x={M.l + iw / 2} y={H - 4} className="axis-label" textAnchor="middle">{p.xLabel}</text>
      <text transform={`translate(12 ${M.t + ih / 2}) rotate(-90)`} className="axis-label" textAnchor="middle">{p.yLabel}</text>
    </svg>
  );
}
