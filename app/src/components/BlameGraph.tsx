// Hand-rolled SVG bipartite view: fraud cards (left) blame candidate buckets (right).
// b_ij = theta_j / S_i, computed here from the theta values the Pregel procedure returned for this iteration.
import type { BucketCard } from "../lib/db";

interface Props {
  cards: BucketCard[];
  theta: Map<string, number> | null; // null = initial uniform blame b_ij = 1/deg(i)
  focus: string;
  labelOf: (bucketId: string) => string;
  poc: Set<string>;
}

const W = 900;
const H = 470;
const XL = 120;
const XR = 590;

export default function BlameGraph({ cards, theta, focus, labelOf, poc }: Props) {
  if (cards.length === 0) return <div className="chart-empty">Run BreachRadar to see the blame flow.</div>;
  // blame per (card, bucket)
  const blame = cards.map((c) => {
    if (!theta) return c.buckets.map(() => 1 / c.buckets.length);
    const th = c.buckets.map((b) => theta.get(b.id) ?? b.theta);
    const S = th.reduce((a, b) => a + b, 0) || 1;
    return th.map((t) => t / S);
  });
  const z = new Map<string, number>();
  cards.forEach((c, i) => c.buckets.forEach((b, j) => z.set(b.id, (z.get(b.id) ?? 0) + blame[i][j])));
  const ranked = [...z.entries()].sort((a, b) => (a[0] === focus ? -1 : b[0] === focus ? 1 : b[1] - a[1]));
  const MAXB = 9;
  const shown = ranked.slice(0, MAXB).map(([id]) => id);
  const shownSet = new Set(shown);
  const bY = (id: string) => 44 + (shown.indexOf(id) * (H - 120)) / Math.max(1, shown.length);
  const otherY = H - 38;
  const cY = (i: number) => 28 + (i * (H - 56)) / Math.max(1, cards.length - 1);
  const rOf = (id: string) => Math.min(17, 6 + 2.2 * Math.sqrt(z.get(id) ?? 0));
  const thetaOf = (id: string) => theta?.get(id) ?? cards.flatMap((c) => c.buckets).find((b) => b.id === id)?.theta ?? 0;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="blame" role="img">
      <text x={XL} y={14} className="col-title" textAnchor="middle">fraud cards</text>
      <text x={XR} y={14} className="col-title" textAnchor="middle">candidate buckets (terminal · week)</text>
      {cards.map((c, i) =>
        c.buckets.map((b, j) => {
          const w = blame[i][j];
          const y2 = shownSet.has(b.id) ? bY(b.id) : otherY;
          const isFocus = b.id === focus;
          return (
            <line
              key={`${c.card}-${b.id}`}
              x1={XL + 6}
              y1={cY(i)}
              x2={XR - rOf(b.id) - 2}
              y2={y2}
              stroke={isFocus ? "#e11d48" : "#64748b"}
              strokeOpacity={Math.min(0.9, 0.08 + w * 1.1)}
              strokeWidth={0.4 + 4.2 * w}
              className={w > 0.25 ? "flow" : undefined}
            />
          );
        }),
      )}
      {cards.map((c, i) => (
        <circle key={c.card} cx={XL} cy={cY(i)} r={4.5} fill="#0f172a">
          <title>card {c.card}</title>
        </circle>
      ))}
      {shown.map((id) => {
        const isFocus = id === focus;
        return (
          <g key={id}>
            <circle cx={XR} cy={bY(id)} r={rOf(id)} fill={isFocus ? "#e11d48" : poc.has(id) ? "#f59e0b" : "#94a3b8"} stroke="#0f172a" strokeWidth={1}>
              <title>{`${labelOf(id)}  z=${(z.get(id) ?? 0).toFixed(2)}  θ=${thetaOf(id).toFixed(3)}${poc.has(id) ? "  (injected POC)" : ""}`}</title>
            </circle>
            <text x={XR + rOf(id) + 8} y={bY(id) + 4} className={isFocus ? "bl-label focus" : "bl-label"}>
              {labelOf(id)} <tspan className="bl-theta">θ {thetaOf(id).toFixed(2)}</tspan>
            </text>
          </g>
        );
      })}
      {ranked.length > MAXB && (
        <g>
          <circle cx={XR} cy={otherY} r={6} fill="none" stroke="#94a3b8" strokeDasharray="3 3" />
          <text x={XR + 14} y={otherY + 4} className="bl-label">{ranked.length - MAXB} other buckets</text>
        </g>
      )}
    </svg>
  );
}
