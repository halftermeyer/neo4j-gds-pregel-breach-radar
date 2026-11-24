import { useEffect, useMemo, useState } from "react";
import { useDemo } from "./Demo";
import { NeedsData, ProblemBanner, ScenarioHead, Stat, StepList } from "./Common";
import { LineChart } from "./Charts";
import BlameGraph from "./BlameGraph";
import { runPipeline, type RunResult } from "../lib/pipeline";
import { METHODS, atK, averagePrecision, prCurve, rankCount, rankGreedy, rankPrior, rankRatio, rankTheta, type MethodKey, type Ranked } from "../lib/eval";
import { fmt, ms, pct } from "../lib/format";

export function rankingsOf(run: RunResult): Record<MethodKey, Ranked[]> {
  return {
    count: rankCount(run.buckets),
    ratio: rankRatio(run.buckets),
    prior: rankPrior(run.buckets),
    greedy: rankGreedy(run.buckets.map((b) => b.id), run.edges),
    breachradar: rankTheta(run.buckets),
  };
}

export function ComparisonTable({ run, rankings }: { run: RunResult; rankings: Record<MethodKey, Ranked[]> }) {
  const K = run.truth.size;
  const detectable = run.buckets.filter((b) => run.truth.has(b.id)).length;
  return (
    <>
      <table className="tbl cmp">
        <thead>
          <tr><th>method</th><th>precision@{K}</th><th>recall@{2 * K}</th><th>average precision</th></tr>
        </thead>
        <tbody>
          {METHODS.map((m) => {
            const r = rankings[m.key];
            const a = atK(r, run.truth, K);
            const b = atK(r, run.truth, 2 * K);
            return (
              <tr key={m.key} className={m.key === "breachradar" ? "hl" : ""}>
                <td><i className="dot" style={{ background: m.color }} />{m.label}</td>
                <td>{pct(a.precision)} <small>({a.hits}/{K})</small></td>
                <td>{pct(b.recall)} <small>({b.hits}/{K})</small></td>
                <td>{averagePrecision(r, run.truth).toFixed(2)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="hint">
        {K} injected POC buckets, {detectable} of them have at least 5 fraud-cards (the best any method can reach on recall: {pct(detectable / K)}).
        All methods rank the same candidate set (buckets with ≥ 5 fraud-cards), against the injected ground truth.
      </p>
    </>
  );
}

export default function Scenario2() {
  const { defaults, bucketLabel, meta } = useDemo();
  const [run, setRun] = useState<RunResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [err, setErr] = useState("");
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [focus, setFocus] = useState("");

  const go = async () => {
    setBusy(true);
    setErr("");
    setPlaying(false);
    try {
      const r = await runPipeline({ p: defaults.p, noise: defaults.noise, cutoffWeek: meta?.weeks ?? 12, seed: defaults.seed, snapshots: true, neighbourhoods: 6 }, setStep);
      setRun(r);
      setFrame(0);
      setFocus([...r.buckets].sort((a, b) => (b.theta ?? 0) - (a.theta ?? 0))[0]?.id ?? "");
      setPlaying(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const frames = useMemo(() => {
    if (!run?.snapshots) return [];
    return run.snapshots.map((s, i) => ({
      label: i === 0 ? "start: uniform blame, θ⁰" : `θ after ${s.k} iteration${s.k > 1 ? "s" : ""}${s.k === run.summary.iterations ? " (converged)" : ""}`,
      blame: i === 0 ? null : s.theta,
      theta: s.theta,
      k: s.k,
    }));
  }, [run]);

  useEffect(() => {
    if (!playing || frames.length === 0) return;
    const t = setInterval(() => {
      setFrame((f) => {
        if (f >= frames.length - 1) {
          setPlaying(false);
          return f;
        }
        return f + 1;
      });
    }, 1100);
    return () => clearInterval(t);
  }, [playing, frames.length]);

  const view = useMemo(() => {
    if (!run) return null;
    const rankings = rankingsOf(run);
    const top = rankings.breachradar.slice(0, 10);
    const st = new Map(run.buckets.map((b) => [b.id, b]));
    const curves = METHODS.map((m) => ({
      name: m.label,
      color: m.color,
      width: m.key === "breachradar" ? 3.4 : 2,
      dashed: m.key === "count" || m.key === "ratio",
      points: prCurve(rankings[m.key], run.truth, Math.max(60, run.truth.size * 3)).map((p) => ({ x: p.recall, y: p.precision })),
    }));
    return { rankings, top, st, curves };
  }, [run]);

  const cur = frames[Math.min(frame, frames.length - 1)];
  const deltaPts = run ? run.summary.deltas.map((d, i) => ({ x: i + 1, y: Math.max(d, 1e-12) })) : [];

  return (
    <div className="tab-body">
      <ScenarioHead n={2} title="BreachRadar, live: let the cards vote, one location each" pitch="A custom GDS Pregel algorithm. Fraud cards pass blame to the buckets they visited; buckets turn blame into a probability of compromise; repeat until it stops moving." />
      <ProblemBanner
        title="Each fraud card has several suspects, and every suspect looks guilty because of the others."
        caption={<>A card that shopped in 6 merchant-weeks adds one fraud to all 6 counts. Counting double-counts the evidence. The fix: each card spends one unit of blame, split by how suspicious each location already is.</>}
      >
        <svg viewBox="0 0 780 190" className="chart">
          <circle cx={90} cy={95} r={20} fill="#0f172a" />
          <text x={90} y={100} textAnchor="middle" fill="#fff" fontSize="12">fraud</text>
          <text x={90} y={140} textAnchor="middle" className="col-title">1 card</text>
          {[0, 1, 2, 3, 4, 5].map((i) => {
            const y = 22 + i * 29;
            const guilty = i === 2;
            return (
              <g key={i}>
                <line x1={110} y1={95} x2={470} y2={y} stroke={guilty ? "#e11d48" : "#94a3b8"} strokeWidth={guilty ? 3 : 1.4} strokeDasharray={guilty ? undefined : "4 4"} />
                <circle cx={480} cy={y} r={8} fill={guilty ? "#e11d48" : "#cbd5e1"} stroke="#475569" />
                <text x={496} y={y + 4} className="bl-label">{guilty ? "the one that leaked (unknown to the bank)" : "innocent merchant-week"}</text>
              </g>
            );
          })}
          <text x={300} y={184} textAnchor="middle" className="col-title">1 unit of blame per fraud card, shared between all its suspects</text>
        </svg>
      </ProblemBanner>

      <NeedsData>
        <section className="card">
          <div className="btn-row">
            <button data-testid="btn-run-s2" className="btn primary big" disabled={busy} onClick={() => void go()}>▶ Run BreachRadar on the database</button>
            <span className="hint">Stealing probability {pct(defaults.p)}, noise +{defaults.noise}%. Every statement and the Pregel call are in the audit drawer (right edge).</span>
          </div>
          {(busy || run) && <StepList steps={run?.steps ?? []} running={busy} current={step} />}
          {err && <div className="bad">{err}</div>}
        </section>

        {run && view && cur && (
          <>
            <div className="stats" data-testid="s2-done">
              <Stat label="theta iterations to converge" value={run.summary.iterations} sub={run.summary.didConverge ? `converged (ε = 1e-6)` : "hit max iterations"} tone={run.summary.didConverge ? "good" : "warn"} />
              <Stat label="Pregel supersteps" value={run.summary.supersteps} />
              <Stat label="Pregel compute" value={ms(run.summary.computeMillis)} sub="inside the GDS procedure" />
              <Stat label="fraud cards in the graph" value={fmt(run.summary.victimCount)} />
              <Stat label="candidate buckets (≥ 5 fraud cards)" value={fmt(run.summary.causeCount)} />
              <Stat label="bipartite edges" value={fmt(run.projected.relationshipCount / 2)} />
            </div>

            <section className="card" data-testid="s2-blame">
              <h3>Blame flowing from cards to buckets</h3>
              <div className="player">
                <button className="btn" onClick={() => { if (frame >= frames.length - 1) setFrame(0); setPlaying(!playing); }}>{playing ? "❚❚ Pause" : "▶ Play"}</button>
                <input type="range" min={0} max={frames.length - 1} value={frame} onChange={(e) => { setPlaying(false); setFrame(Number(e.target.value)); }} />
                <b>{cur.label}</b>
              </div>
              <div className="chips">
                {[...run.neighbourhoods!.keys()].map((id) => (
                  <button key={id} className={`chip ${id === focus ? "on" : ""}`} onClick={() => setFocus(id)}>{bucketLabel(id)}</button>
                ))}
              </div>
              <div className="grid2 wide-left">
                <BlameGraph cards={run.neighbourhoods!.get(focus) ?? []} theta={cur.blame} focus={focus} labelOf={bucketLabel} poc={run.truth} />
                <div>
                  <h4>Convergence: L1 change of θ per iteration</h4>
                  <LineChart
                    series={[{ name: "Σ|θ − θ_prev|", color: "#e11d48", points: deltaPts }]}
                    logY
                    xLabel="iteration"
                    yLabel="L1 change"
                    height={210}
                    hLine={{ y: 1e-6, label: "ε = 1e-6" }}
                    markerX={Math.max(1, cur.k)}
                    legend={false}
                  />
                  <h4>θ of the 10 top buckets at this iteration</h4>
                  <div className="bars">
                    {view.top.map((t) => {
                      const th = cur.theta.get(t.id) ?? 0;
                      return (
                        <div key={t.id} className="bar-row">
                          <span className="bar-label" title={bucketLabel(t.id)}>{bucketLabel(t.id)}</span>
                          <div className="bar-track"><i style={{ width: `${Math.min(100, th * 100)}%`, background: run.truth.has(t.id) ? "#e11d48" : "#94a3b8" }} /></div>
                          <b>{th.toFixed(2)}</b>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
              <p className="hint">
                Edge width = blame b<sub>ij</sub> = θ<sub>j</sub> / S<sub>i</sub> computed from the θ values returned by <code>breachradar.pregel.stream</code> after <i>k</i> iterations
                (a real Pregel run per frame). Red = the selected bucket; amber = another injected POC.
              </p>
            </section>

            <div className="grid2">
              <section className="card">
                <h3>Top points of compromise</h3>
                <table className="tbl">
                  <thead><tr><th>#</th><th>merchant · week</th><th>θ (P compromised)</th><th>fraud / cards</th><th>truth</th></tr></thead>
                  <tbody>
                    {view.rankings.breachradar.slice(0, 15).map((r, i) => {
                      const s = view.st.get(r.id)!;
                      return (
                        <tr key={r.id} className={run.truth.has(r.id) ? "hit" : "miss"}>
                          <td>{i + 1}</td><td>{bucketLabel(r.id)}</td><td><b>{pct(r.score, 1)}</b></td><td>{s.f} / {s.n}</td><td>{run.truth.has(r.id) ? "✓ injected" : "✗"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </section>
              <section className="card" data-testid="s2-scored">
                <h3>Scored against the injected ground truth</h3>
                <ComparisonTable run={run} rankings={view.rankings} />
              </section>
            </div>

            <section className="card" data-testid="s2-pr">
              <h3>Precision–recall, all methods</h3>
              <LineChart series={view.curves} xLabel="recall" yLabel="precision" xMin={0} xMax={1} yMin={0} yMax={1} height={320} xFormat={(x) => pct(x)} yFormat={(y) => pct(y)} />
              <pre className="code">{`CALL breachradar.pregel.write('br', {alpha: 0.2, beta: 15, epsilon: 1e-6, maxIterations: 100, concurrency: 4,
                                    populationProperty: 'n', writeProperty: 'theta'})
YIELD iterations, supersteps, didConverge, deltas, computeMillis`}</pre>
            </section>
          </>
        )}
      </NeedsData>
    </div>
  );
}
