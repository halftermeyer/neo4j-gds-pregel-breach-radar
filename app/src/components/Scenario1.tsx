import { useMemo, useState } from "react";
import { useDemo } from "./Demo";
import { NeedsData, ProblemBanner, ScenarioHead, Stat, StepList } from "./Common";
import { Scatter, type Dot } from "./Charts";
import { loadRaw, type RawResult } from "../lib/pipeline";
import { rankCount, rankRatio, type BucketStat, type Ranked } from "../lib/eval";
import { mulberry32 } from "../lib/rng";
import { fmt, pct } from "../lib/format";

/** Illustrative hairball: a few fraud cards, each linked to the merchants it visited. Which one leaked? */
function Hairball() {
  const r = mulberry32(7);
  const W = 780;
  const H = 250;
  const cards = Array.from({ length: 22 }, (_, i) => ({ y: 18 + (i * (H - 36)) / 21 }));
  const buckets = Array.from({ length: 16 }, (_, j) => ({ y: 18 + (j * (H - 36)) / 15 }));
  const links: [number, number][] = [];
  cards.forEach((_, i) => {
    const k = 3 + Math.floor(r() * 3);
    const picked = new Set<number>();
    while (picked.size < k) picked.add(Math.floor(r() * buckets.length));
    picked.forEach((j) => links.push([i, j]));
  });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart hair">
      {links.map(([i, j], n) => (
        <line key={n} x1={150} y1={cards[i].y} x2={W - 190} y2={buckets[j].y} stroke="#64748b" strokeOpacity={0.35} />
      ))}
      {cards.map((c, i) => <circle key={i} cx={150} cy={c.y} r={5} fill="#0f172a" />)}
      {buckets.map((b, j) => (
        <g key={j}>
          <circle cx={W - 190} cy={b.y} r={6} fill="#cbd5e1" stroke="#64748b" />
          <text x={W - 178} y={b.y + 4} className="bl-label">merchant, week ?</text>
        </g>
      ))}
      <text x={150} y={H - 2} textAnchor="middle" className="col-title">fraud cards</text>
      <text x={W - 130} y={H - 2} textAnchor="middle" className="col-title">where did they all shop before the fraud?</text>
      <text x={W / 2} y={H / 2} textAnchor="middle" className="hair-q">which merchant leaked the card data?</text>
    </svg>
  );
}

function RankTable({ title, note, rows, stats, labelOf, truth, reveal }: { title: string; note: string; rows: Ranked[]; stats: Map<string, BucketStat>; labelOf: (id: string) => string; truth: Set<string>; reveal: boolean }) {
  const hits = rows.filter((r) => truth.has(r.id)).length;
  return (
    <div className="rank">
      <h4>{title}</h4>
      <p className="hint">{note}</p>
      <table className="tbl">
        <thead><tr><th>#</th><th>merchant · week</th><th>fraud / cards</th><th>score</th>{reveal && <th></th>}</tr></thead>
        <tbody>
          {rows.map((r, i) => {
            const s = stats.get(r.id)!;
            return (
              <tr key={r.id} className={reveal ? (truth.has(r.id) ? "hit" : "miss") : ""}>
                <td>{i + 1}</td>
                <td>{labelOf(r.id)}</td>
                <td>{s.f} / {s.n}</td>
                <td>{r.score < 1.5 && r.score > 0 && title.includes("ratio") ? pct(r.score) : fmt(r.score, 0)}</td>
                {reveal && <td>{truth.has(r.id) ? "✓ real POC" : "✗"}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
      {reveal && <div className="verdict">{hits} of {rows.length} are real points of compromise</div>}
    </div>
  );
}

export default function Scenario1() {
  const { defaults, bucketLabel, meta } = useDemo();
  const [raw, setRaw] = useState<RawResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [err, setErr] = useState("");

  const load = async () => {
    setBusy(true);
    setErr("");
    setReveal(false);
    try {
      setRaw(await loadRaw({ p: defaults.p, noise: defaults.noise, cutoffWeek: meta?.weeks ?? 12, seed: defaults.seed }));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const view = useMemo(() => {
    if (!raw) return null;
    const stats = new Map(raw.buckets.map((b) => [b.id, b]));
    const byCount = rankCount(raw.buckets).slice(0, 10);
    const byRatio = rankRatio(raw.buckets).slice(0, 10);
    const dots: Dot[] = raw.buckets.map((b) => ({
      x: b.n,
      y: b.f,
      color: reveal && raw.truth.has(b.id) ? "#e11d48" : "#94a3b8",
      r: reveal && raw.truth.has(b.id) ? 5 : 2.6,
      ring: reveal && raw.truth.has(b.id),
      title: `${bucketLabel(b.id)}: ${b.f} fraud / ${b.n} cards`,
    }));
    return { stats, byCount, byRatio, dots };
  }, [raw, reveal, bucketLabel]);

  return (
    <div className="tab-body">
      <ScenarioHead n={1} title="Fraud cards are scattered: which merchant is guilty?" pitch="A fraud ring buys with stolen card data. The card issuer sees only the fraud, weeks after the card number leaked at one merchant." />
      <ProblemBanner
        title="Every fraud card visited several merchants. Only one of them leaked the card."
        caption={<>Analysts pivot on what they can count: fraud cards per merchant-week, or the fraud ratio. Illustration only: the live numbers come from the graph below.</>}
      >
        <Hairball />
      </ProblemBanner>

      <NeedsData>
        <section className="card">
          <div className="btn-row">
            <button className="btn primary" disabled={busy} onClick={() => void load()}>
              {raw ? "Reload the fraud feed" : "Load the fraud feed and rank merchants the naive way"}
            </button>
            <span className="hint">Stealing probability {pct(defaults.p)}, noise +{defaults.noise}% fraud cards with no POC. Nothing runs in the algorithm yet: these are plain Cypher counts.</span>
          </div>
          {(busy || raw) && <StepList steps={raw?.steps ?? []} running={busy} current="Counting fraud-cards per merchant-week" />}
          {err && <div className="bad">{err}</div>}
        </section>

        {raw && view && (
          <>
            <div className="stats">
              <Stat label="fraud cards" value={fmt(raw.fraudCards)} />
              <Stat label="merchant-weeks with ≥ 1 fraud card" value={fmt(raw.buckets.length)} />
              <Stat label="largest fraud-card count in one merchant-week" value={Math.max(...raw.buckets.map((b) => b.f))} />
            </div>
            <div className="grid2">
              <RankTable title="Top 10 by fraud-card count" note="Biggest number of fraud cards. Big, busy merchants win just by having more customers." rows={view.byCount} stats={view.stats} labelOf={bucketLabel} truth={raw.truth} reveal={reveal} />
              <RankTable title="Top 10 by fraud-card ratio" note="Share of the merchant-week's cards that are fraud. Tiny merchants with 2 customers, both fraud, win by chance." rows={view.byRatio} stats={view.stats} labelOf={bucketLabel} truth={raw.truth} reveal={reveal} />
            </div>
            <section className="card">
              <h3>Why both rankings fail</h3>
              <div className="btn-row">
                <button className="btn" onClick={() => setReveal(!reveal)}>{reveal ? "Hide" : "Reveal"} the injected points of compromise</button>
                <span className="hint">Each dot is a merchant-week. Count follows size (right); ratio follows small numbers (top-left).</span>
              </div>
              <Scatter dots={view.dots} xLabel="cards on the merchant-week (n)" yLabel="fraud cards (f)" logX />
              {reveal && (
                <p className="callout">
                  The real compromised merchant-weeks (red rings) are <b>not</b> the top of either list. The question is a <b>causal attribution</b> problem:
                  each fraud card should blame one location, and a location is guilty only if it explains cards that nothing else explains.
                  That is what BreachRadar does, in scenario 2.
                </p>
              )}
            </section>
          </>
        )}
      </NeedsData>
    </div>
  );
}
