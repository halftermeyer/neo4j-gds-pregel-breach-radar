import { useMemo, useState } from "react";
import { useDemo } from "./Demo";
import { NeedsData, ProblemBanner, ScenarioHead, Slider, Stat, StepList } from "./Common";
import { LineChart, type Series } from "./Charts";
import { ComparisonTable, rankingsOf } from "./Scenario2";
import { runPipeline, type RunResult } from "../lib/pipeline";
import { METHODS, atK, type MethodKey } from "../lib/eval";
import { fmt, ms, pct } from "../lib/format";
import { mulberry32 } from "../lib/rng";

interface Pt {
  x: number;
  m: Record<MethodKey, { precision: number; recall: number }>;
}

function metricsOf(run: RunResult): Pt["m"] {
  const rk = rankingsOf(run);
  const K = run.truth.size;
  const out = {} as Pt["m"];
  for (const m of METHODS) out[m.key] = { precision: atK(rk[m.key], run.truth, K).precision, recall: atK(rk[m.key], run.truth, 2 * K).recall };
  return out;
}

/** 200 customers of a breached merchant-week: the share defrauded is p. Black = fraud with no link to this breach (noise). */
function Crowd({ p, noise }: { p: number; noise: number }) {
  const r = mulberry32(11);
  const cols = 25;
  const rows = 8;
  const total = cols * rows;
  const order = Array.from({ length: total }, (_, i) => i).sort(() => r() - 0.5);
  const hit = new Set(order.slice(0, Math.round(total * p)));
  const noiseN = Math.round(Math.round(total * p) * (noise / 100));
  const noiseSet = new Set(order.slice(total - noiseN));
  return (
    <svg viewBox="0 0 780 170" className="chart">
      {Array.from({ length: total }, (_, i) => {
        const cx = 30 + (i % cols) * 16;
        const cy = 18 + Math.floor(i / cols) * 17;
        const compromised = hit.has(i);
        const isNoise = noiseSet.has(i) && !compromised;
        return <circle key={i} cx={cx} cy={cy} r={6} fill={compromised ? "#e11d48" : isNoise ? "#0f172a" : "#e2e8f0"} stroke={compromised || isNoise ? "none" : "#cbd5e1"} />;
      })}
      <text x={460} y={34} className="crowd-t">200 customers of one breached merchant-week</text>
      <text x={460} y={62} className="crowd-s"><tspan fill="#e11d48">●</tspan> defrauded because of the breach: {Math.round(total * p)} ({pct(p)})</text>
      <text x={460} y={84} className="crowd-s"><tspan fill="#0f172a">●</tspan> other fraud, unrelated to this breach (noise): {noiseN}</text>
      <text x={460} y={106} className="crowd-s"><tspan fill="#cbd5e1">●</tspan> never defrauded</text>
      <text x={460} y={138} className="crowd-s">The lower p is, the fewer fraud cards each breach leaves behind,</text>
      <text x={460} y={156} className="crowd-s">and the more it looks like noise. Early = few victims so far.</text>
    </svg>
  );
}

export default function Scenario3() {
  const { defaults, meta } = useDemo();
  const [p, setP] = useState(defaults.p);
  const [noise, setNoise] = useState(defaults.noise);
  const [run, setRun] = useState<RunResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [err, setErr] = useState("");
  const [sweepP, setSweepP] = useState<Pt[]>([]);
  const [sweepN, setSweepN] = useState<Pt[]>([]);
  const [sweeping, setSweeping] = useState("");

  const exec = async (pp: number, nn: number) => runPipeline({ p: pp, noise: nn, cutoffWeek: meta?.weeks ?? 12, seed: defaults.seed }, setStep);

  const rerun = async (pp = p, nn = noise) => {
    setBusy(true);
    setErr("");
    try {
      setRun(await exec(pp, nn));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const sweep = async (kind: "p" | "noise") => {
    setBusy(true);
    setErr("");
    setSweeping(kind);
    const pts: Pt[] = [];
    (kind === "p" ? setSweepP : setSweepN)([]);
    try {
      const grid = kind === "p" ? [0.1, 0.15, 0.2, 0.3, 0.45, 0.6, 0.8, 1.0] : [0, 25, 50, 75, 100];
      for (const x of grid) {
        const r = kind === "p" ? await exec(x, noise) : await exec(p, x);
        pts.push({ x: kind === "p" ? x * 100 : x, m: metricsOf(r) });
        (kind === "p" ? setSweepP : setSweepN)([...pts]);
        setRun(r);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
      setSweeping("");
    }
  };

  const series = (pts: Pt[], metric: "precision" | "recall"): Series[] =>
    METHODS.map((m) => ({ name: m.label, color: m.color, width: m.key === "breachradar" ? 3.6 : 2, dashed: m.key === "count" || m.key === "ratio", points: pts.map((q) => ({ x: q.x, y: q.m[m.key][metric] })) }));

  const rankings = useMemo(() => (run ? rankingsOf(run) : null), [run]);

  return (
    <div className="tab-body">
      <ScenarioHead n={3} title="Early detection: how little fraud does it take to find a breach?" pitch="Turn the stealing probability down and the noise up. Every change re-runs the actual Pregel algorithm on the database." />
      <ProblemBanner
        title="Early on, a breach has barely produced any fraud. It hides in the noise."
        caption="Live: the picture follows the sliders below. The bank only sees the red and black dots as undifferentiated fraud cards."
      >
        <Crowd p={p} noise={noise} />
      </ProblemBanner>

      <NeedsData>
        <section className="card">
          <div className="sliders">
            <Slider label="Stealing probability p" value={p * 100} min={10} max={100} step={5} format={(v) => `${v}%`} onChange={(v) => setP(v / 100)} onCommit={() => void rerun()} disabled={busy} />
            <Slider label="Noise (fraud cards with no POC)" value={noise} min={0} max={100} step={10} format={(v) => `+${v}%`} onChange={setNoise} onCommit={() => void rerun()} disabled={busy} />
          </div>
          <div className="btn-row">
            <button className="btn primary" disabled={busy} onClick={() => void rerun()}>Re-run BreachRadar at these settings</button>
            <button className="btn" disabled={busy} onClick={() => void sweep("p")}>Sweep p from 10% to 100% (8 runs)</button>
            <button className="btn" disabled={busy} onClick={() => void sweep("noise")}>Sweep noise from 0 to +100% (5 runs)</button>
            {sweeping && <span className="hint">sweeping {sweeping === "p" ? "stealing probability" : "noise"}…</span>}
          </div>
          {(busy || run) && <StepList steps={run?.steps ?? []} running={busy} current={step} />}
          {err && <div className="bad">{err}</div>}
        </section>

        {run && rankings && (
          <>
            <div className="stats">
              <Stat label="fraud cards" value={fmt(run.fraudCards)} sub={`p = ${pct(run.params.p)}, noise +${run.params.noise}%`} />
              <Stat label="candidate buckets" value={fmt(run.keptBuckets)} />
              <Stat label="iterations" value={run.summary.iterations} sub={run.summary.didConverge ? "converged" : "max reached"} />
              <Stat label="Pregel compute" value={ms(run.summary.computeMillis)} />
              <Stat label="whole re-run" value={ms(run.totalMs)} sub="labels, projection, Pregel, scoring" />
            </div>
            <section className="card">
              <h3>This run</h3>
              <ComparisonTable run={run} rankings={rankings} />
            </section>
          </>
        )}

        <div className="grid2">
          <section className="card">
            <h3>Precision vs stealing probability <small>(noise +{noise}%)</small></h3>
            <LineChart series={series(sweepP, "precision")} xLabel="stealing probability p (%)" yLabel="precision@K" yMin={0} yMax={1} xMin={10} xMax={100} xTicks={[10, 25, 50, 75, 100]} yFormat={(y) => pct(y)} empty="Run the p sweep to draw this curve" />
          </section>
          <section className="card">
            <h3>Recall vs stealing probability <small>(noise +{noise}%)</small></h3>
            <LineChart series={series(sweepP, "recall")} xLabel="stealing probability p (%)" yLabel="recall@2K" yMin={0} yMax={1} xMin={10} xMax={100} xTicks={[10, 25, 50, 75, 100]} yFormat={(y) => pct(y)} empty="Run the p sweep to draw this curve" />
          </section>
          <section className="card">
            <h3>Precision vs noise <small>(p = {pct(p)})</small></h3>
            <LineChart series={series(sweepN, "precision")} xLabel="extra noise cards (% of compromised cards)" yLabel="precision@K" yMin={0} yMax={1} xMin={0} xMax={100} xTicks={[0, 25, 50, 75, 100]} yFormat={(y) => pct(y)} empty="Run the noise sweep to draw this curve" />
          </section>
          <section className="card">
            <h3>Recall vs noise <small>(p = {pct(p)})</small></h3>
            <LineChart series={series(sweepN, "recall")} xLabel="extra noise cards (% of compromised cards)" yLabel="recall@2K" yMin={0} yMax={1} xMin={0} xMax={100} xTicks={[0, 25, 50, 75, 100]} yFormat={(y) => pct(y)} empty="Run the noise sweep to draw this curve" />
          </section>
        </div>
        <p className="hint">K = number of injected POC buckets. precision@K: share of the K top-ranked buckets that are real. recall@2K: share of real POC buckets found within the top 2K. Every point is a fresh run of the Pregel algorithm on freshly labelled data (same seed, so curves are comparable).</p>
      </NeedsData>
    </div>
  );
}
