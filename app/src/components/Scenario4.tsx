import { useMemo, useState } from "react";
import { useDemo } from "./Demo";
import { NeedsData, ProblemBanner, ScenarioHead, Sim, Slider, Stat, StepList } from "./Common";
import { LineChart } from "./Charts";
import { rankingsOf } from "./Scenario2";
import { runPipeline, type RunResult } from "../lib/pipeline";
import { METHODS, type Ranked } from "../lib/eval";
import { fmt, pct, usd } from "../lib/format";
import type { ReissueData } from "../lib/db";

function outcome(buckets: string[], rd: ReissueData) {
  const seen = new Set<number>();
  for (const b of buckets) for (const c of rd.bucketCards.get(b) ?? []) seen.add(c);
  let prevented = 0;
  let txs = 0;
  for (const c of seen) {
    const f = rd.cardFraud.get(c);
    if (f) {
      prevented += f.amount;
      txs += f.count;
    }
  }
  return { cards: seen.size, prevented, txs };
}

/** Running union as buckets are reissued in rank order: [{cards, prevented}] */
function curve(ranking: Ranked[], rd: ReissueData, maxBuckets = 80) {
  const seen = new Set<number>();
  let prevented = 0;
  const pts = [{ x: 0, y: 0 }];
  for (const r of ranking.slice(0, maxBuckets)) {
    for (const c of rd.bucketCards.get(r.id) ?? []) {
      if (seen.has(c)) continue;
      seen.add(c);
      prevented += rd.cardFraud.get(c)?.amount ?? 0;
    }
    pts.push({ x: seen.size, y: prevented });
  }
  return pts;
}

export default function Scenario4() {
  const { defaults, meta, bucketLabel } = useDemo();
  const weeks = meta?.weeks ?? 12;
  const [decision, setDecision] = useState(Math.max(4, weeks - 4));
  const [cost, setCost] = useState(10);
  const [thr, setThr] = useState(0);
  const [run, setRun] = useState<RunResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [err, setErr] = useState("");

  const go = async () => {
    setBusy(true);
    setErr("");
    try {
      const r = await runPipeline({ p: defaults.p, noise: defaults.noise, cutoffWeek: decision, seed: defaults.seed, reissue: true }, setStep);
      setRun(r);
      const th = rankingsOf(r).breachradar;
      setThr(Math.round((th[Math.min(th.length - 1, r.truth.size - 1)]?.score ?? 0.1) * 100) / 100);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const v = useMemo(() => {
    if (!run?.reissue) return null;
    const rd = run.reissue;
    const rk = rankingsOf(run);
    const maxTheta = rk.breachradar[0]?.score ?? 0.5;
    const flagged = rk.breachradar.filter((r) => r.score >= thr).map((r) => r.id);
    const out = outcome(flagged, rd);
    const real = flagged.filter((id) => run.truth.has(id)).length;
    const totalFuture = [...rd.cardFraud.values()].reduce((a, b) => a + b.amount, 0);
    // equal-volume comparison: every method reissues (at least) the same number of cards
    const equal = METHODS.map((m) => {
      const ranked = rk[m.key];
      const picked: string[] = [];
      let o = { cards: 0, prevented: 0, txs: 0 };
      for (const r of ranked) {
        if (o.cards >= out.cards) break;
        picked.push(r.id);
        o = outcome(picked, rd);
      }
      return { ...m, ...o, buckets: picked.length };
    });
    const series = [
      ...METHODS.map((m) => ({
        name: m.label,
        color: m.color,
        width: m.key === "breachradar" ? 3.6 : 2,
        dashed: m.key === "count" || m.key === "ratio",
        dots: false,
        points: curve(rk[m.key], rd).map((q) => ({ x: q.x * cost, y: q.y })),
      })),
      { name: "break-even (prevented = reissue cost)", color: "#16a34a", dashed: true, width: 1.4, dots: false, points: [{ x: 0, y: 0 }, { x: Math.max(...curve(rk.breachradar, rd).map((q) => q.x)) * cost, y: Math.max(...curve(rk.breachradar, rd).map((q) => q.x)) * cost }] },
    ];
    return { rd, rk, maxTheta, flagged, out, real, totalFuture, equal, series };
  }, [run, thr, cost]);

  const weekly = run?.reissue?.weeklyFraud ?? [];
  const maxW = Math.max(1, ...weekly.map((w) => w.amount));

  return (
    <div className="tab-body">
      <ScenarioHead n={4} title="Business value: reissue the cards that were exposed, not everyone" pitch="Reissue every card seen at buckets above a probability threshold. Compare the fraud it would have prevented with what the reissuing costs." />
      <Sim>SIMULATED on synthetic data. Not PNC data, not a forecast. Assumption: a reissued card suffers no further fraud.</Sim>
      <ProblemBanner
        title="Waiting for the fraud to pile up is expensive. Reissuing everyone is expensive too."
        caption="Illustration: fraud keeps growing every week after a breach until the exposed cards are replaced. The real weekly fraud from the dataset appears below once the simulation has run."
      >
        <svg viewBox="0 0 780 180" className="chart">
          {[10, 18, 30, 46, 66, 90, 112, 132].map((h, i) => (
            <g key={i}>
              <rect x={60 + i * 52} y={150 - h} width={36} height={h} rx={4} fill={i < 3 ? "#cbd5e1" : "#fda4af"} />
              <text x={78 + i * 52} y={168} textAnchor="middle" className="tick">wk {i + 1}</text>
            </g>
          ))}
          <line x1={60 + 2.5 * 52 + 8} x2={60 + 2.5 * 52 + 8} y1={10} y2={152} stroke="#e11d48" strokeDasharray="5 4" />
          <text x={60 + 2.5 * 52 + 14} y={24} className="col-title">breach</text>
          <line x1={60 + 5.5 * 52} x2={60 + 5.5 * 52} y1={10} y2={152} stroke="#16a34a" strokeDasharray="5 4" />
          <text x={60 + 5.5 * 52 + 6} y={24} className="col-title">reissue here → everything after is prevented</text>
          <text x={520} y={100} className="crowd-s">fraud $ per week</text>
        </svg>
      </ProblemBanner>

      <NeedsData>
        <section className="card">
          <div className="sliders">
            <Slider label="Decision time (end of week)" value={decision} min={4} max={weeks - 1} step={1} format={(x) => `wk ${x}`} onChange={setDecision} disabled={busy} />
            <label className="slider"><span>Reissue cost per card</span>
              <input type="number" className="num" value={cost} min={0} step={1} onChange={(e) => setCost(Number(e.target.value))} />
              <b>{usd(cost)}</b>
            </label>
          </div>
          <div className="btn-row">
            <button data-testid="btn-run-s4" className="btn primary big" disabled={busy} onClick={() => void go()}>▶ Run BreachRadar as of week {decision} and simulate the reissue</button>
            <span className="hint">Only fraud known by the end of week {decision} is given to the algorithm. Fraud after that is what the reissue can prevent.</span>
          </div>
          {(busy || run) && <StepList steps={run?.steps ?? []} running={busy} current={step} />}
          {err && <div className="bad">{err}</div>}
        </section>

        {run && v && (
          <>
            <section className="card" data-testid="s4-threshold">
              <h3>Reissue every card seen at a bucket with θ ≥ threshold <Sim>simulated</Sim></h3>
              <Slider label="θ threshold" value={thr} min={0.01} max={Math.max(0.05, Math.ceil(v.maxTheta * 100) / 100)} step={0.01} format={(x) => x.toFixed(2)} onChange={setThr} />
              <div className="stats">
                <Stat label="buckets flagged" value={v.flagged.length} sub={`${v.real} are real POCs (${pct(v.flagged.length ? v.real / v.flagged.length : 0)})`} />
                <Stat label="cards reissued" value={fmt(v.out.cards)} />
                <Stat label="reissue cost" value={usd(v.out.cards * cost)} sub={`${usd(cost)} per card`} tone="warn" />
                <Stat label="fraud prevented" value={usd(v.out.prevented)} sub={`${v.out.txs} fraud transactions, of ${usd(v.totalFuture)} still to come`} tone="good" />
                <Stat label="net" value={usd(v.out.prevented - v.out.cards * cost)} sub={v.out.cards ? `${(v.out.prevented / (v.out.cards * cost)).toFixed(1)}× the cost` : ""} tone={v.out.prevented - v.out.cards * cost >= 0 ? "good" : "bad"} />
              </div>
            </section>

            <div className="grid2">
              <section className="card" data-testid="s4-equal">
                <h3>Same reissue volume, different ranking <Sim>simulated</Sim></h3>
                <p className="hint">Each method reissues buckets in its own order until it has replaced at least as many cards as BreachRadar above.</p>
                <table className="tbl">
                  <thead><tr><th>method</th><th>buckets</th><th>cards</th><th>fraud prevented</th><th>net</th></tr></thead>
                  <tbody>
                    {v.equal.map((m) => (
                      <tr key={m.key} className={m.key === "breachradar" ? "hl" : ""}>
                        <td><i className="dot" style={{ background: m.color }} />{m.label}</td>
                        <td>{m.buckets}</td><td>{fmt(m.cards)}</td><td>{usd(m.prevented)}</td><td>{usd(m.prevented - m.cards * cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
              <section className="card" data-testid="s4-curve">
                <h3>Fraud prevented vs reissue cost <Sim>simulated</Sim></h3>
                <LineChart series={v.series} xLabel="reissue cost ($)" yLabel="fraud prevented ($)" height={300} xFormat={(x) => usd(x)} yFormat={(y) => usd(y)} />
                <p className="hint">Curves are above the green line where reissuing pays for itself. Each point adds one more bucket in the method's ranking.</p>
              </section>
            </div>

            <section className="card">
              <h3>Fraud $ per week in the dataset <small>(decision at week {run.params.cutoffWeek})</small></h3>
              <svg viewBox="0 0 780 170" className="chart">
                {weekly.map((w, i) => {
                  const h = (w.amount / maxW) * 120;
                  const known = w.week < run.params.cutoffWeek;
                  return (
                    <g key={w.week}>
                      <rect x={50 + i * 56} y={140 - h} width={38} height={h} rx={4} fill={known ? "#94a3b8" : "#e11d48"} />
                      <text x={69 + i * 56} y={156} textAnchor="middle" className="tick">wk {w.week}</text>
                      <text x={69 + i * 56} y={134 - h} textAnchor="middle" className="tick">{usd(w.amount)}</text>
                    </g>
                  );
                })}
                <text x={770} y={14} textAnchor="end" className="col-title">grey = known when the algorithm runs · red = still to come (what a reissue can prevent)</text>
              </svg>
            </section>

            <section className="card">
              <h3>Flagged buckets</h3>
              <table className="tbl">
                <thead><tr><th>merchant · week</th><th>θ</th><th>cards reissued</th><th>truth</th></tr></thead>
                <tbody>
                  {v.flagged.slice(0, 12).map((id) => (
                    <tr key={id} className={run.truth.has(id) ? "hit" : "miss"}>
                      <td>{bucketLabel(id)}</td><td>{pct(run.buckets.find((b) => b.id === id)?.theta ?? 0, 1)}</td><td>{(v.rd.bucketCards.get(id) ?? []).length}</td><td>{run.truth.has(id) ? "✓ injected" : "✗"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </>
        )}
      </NeedsData>
    </div>
  );
}
