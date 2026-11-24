import { useState } from "react";
import { useDemo } from "./Demo";
import { ProblemBanner, ScenarioHead, Stat } from "./Common";
import { LineChart } from "./Charts";
import * as db from "../lib/db";
import { exclusive } from "../lib/pipeline";
import { withGroup } from "../lib/neo4j";
import { fmt, ms } from "../lib/format";
import { mulberry32 } from "../lib/rng";

interface BenchRun {
  id: number;
  edges: number;
  cards: number;
  buckets: number;
  nodes: number;
  concurrency: number;
  genMs: number;
  projectMs: number;
  preMs: number;
  computeMs: number;
  postMs: number;
  wallMs: number;
  iterations: number;
  supersteps: number;
  converged: boolean;
  deltas: number[];
  top: { id: number; theta: number }[];
}

function Growth() {
  const r = mulberry32(5);
  const cluster = (cx: number, n: number, label: string) => {
    const left = Array.from({ length: n }, () => ({ x: cx - 40 - r() * 14, y: 24 + r() * 120 }));
    const right = Array.from({ length: Math.max(3, Math.round(n / 3)) }, () => ({ x: cx + 40 + r() * 14, y: 24 + r() * 120 }));
    return (
      <g key={label}>
        {left.map((a, i) => {
          const b = right[Math.floor(r() * right.length)];
          const b2 = right[Math.floor(r() * right.length)];
          return (
            <g key={i}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#94a3b8" strokeOpacity={0.5} />
              <line x1={a.x} y1={a.y} x2={b2.x} y2={b2.y} stroke="#94a3b8" strokeOpacity={0.5} />
            </g>
          );
        })}
        {left.map((a, i) => <circle key={`l${i}`} cx={a.x} cy={a.y} r={3} fill="#0f172a" />)}
        {right.map((b, i) => <circle key={`r${i}`} cx={b.x} cy={b.y} r={4} fill="#e11d48" />)}
        <text x={cx} y={168} textAnchor="middle" className="col-title">{label}</text>
      </g>
    );
  };
  return (
    <svg viewBox="0 0 780 180" className="chart">
      {cluster(130, 10, "a pilot")}
      {cluster(390, 36, "a region")}
      {cluster(650, 130, "the whole card base")}
      <text x={260} y={92} textAnchor="middle" className="hair-q">→</text>
      <text x={520} y={92} textAnchor="middle" className="hair-q">→</text>
    </svg>
  );
}

const SIZES = [100_000, 500_000, 1_000_000, 2_000_000, 5_000_000];

export default function Scenario5() {
  const { env } = useDemo();
  const [edges, setEdges] = useState(1_000_000);
  const [conc, setConc] = useState(4);
  const [eps, setEps] = useState(1e-4);
  const [maxIt, setMaxIt] = useState(200);
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState({ msg: "", frac: 0 });
  const [steps, setSteps] = useState<string[]>([]);
  const [runs, setRuns] = useState<BenchRun[]>([]);
  const [err, setErr] = useState("");
  const last = runs[runs.length - 1];

  const go = async () => {
    setBusy(true);
    setErr("");
    setSteps([]);
    try {
      await exclusive(() =>
        withGroup(`Scale benchmark — ${fmt(edges)} edges`, async () => {
          const wall0 = performance.now();
          const gen = await db.benchGenerate({ edges, avgDegree: 4, concurrency: conc }, (msg, frac) => setProg({ msg, frac }));
          setSteps((s) => [...s, `Generated ${fmt(gen.edges)} unique card–bucket edges (${fmt(gen.cards)} fraud cards, ${fmt(gen.buckets)} buckets) in ${ms(gen.genMillis)}`]);
          setProg({ msg: "Projecting into GDS memory", frac: 0.96 });
          const t1 = performance.now();
          const proj = await db.benchProject();
          const projMs = Math.round(performance.now() - t1);
          setSteps((s) => [...s, `Projected ${fmt(proj.nodeCount)} nodes, ${fmt(proj.relationshipCount / 2)} edges in ${ms(projMs)}`]);
          setProg({ msg: "Running breachradar.pregel.mutate", frac: 0.98 });
          const sum = await db.benchRun(conc, eps, maxIt);
          setSteps((s) => [...s, `Pregel: ${sum.iterations} iterations, ${sum.supersteps} supersteps, converged=${sum.didConverge}, compute ${ms(sum.computeMillis)}`]);
          const top = await db.benchTop(5);
          setProg({ msg: "Done", frac: 1 });
          setRuns((r) => [
            ...r,
            {
              id: r.length + 1,
              edges: gen.edges,
              cards: gen.cards,
              buckets: gen.buckets,
              nodes: proj.nodeCount,
              concurrency: conc,
              genMs: gen.genMillis,
              projectMs: projMs,
              preMs: sum.preProcessingMillis,
              computeMs: sum.computeMillis,
              postMs: sum.postProcessingMillis,
              wallMs: Math.round(performance.now() - wall0),
              iterations: sum.iterations,
              supersteps: sum.supersteps,
              converged: sum.didConverge,
              deltas: sum.deltas,
              top,
            },
          ]);
        }),
      );
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const cleanup = async () => {
    setBusy(true);
    try {
      await exclusive(() => withGroup("Benchmark cleanup", () => db.benchCleanup()));
      setSteps([]);
      setProg({ msg: "Benchmark data removed", frac: 0 });
    } finally {
      setBusy(false);
    }
  };

  const ready = env?.connected && (env.procedures.length ?? 0) >= 3;

  return (
    <div className="tab-body">
      <ScenarioHead n={5} title="Scale: from a pilot to the whole card base" pitch="The presenter picks a size. The app generates that many card–bucket edges in the database, projects them, runs the Pregel algorithm and reports real timings. Nothing here is pre-baked." />
      <ProblemBanner title="A pilot works on a laptop. Will it hold on the whole card base?" caption="Card data grows by orders of magnitude between a pilot and production. The algorithm has to stay near-linear in the number of edges.">
        <Growth />
      </ProblemBanner>

      {!ready && <div className="empty bad">Neo4j or the BreachRadar plugin is not available. See the Setup tab.</div>}
      {ready && (
        <>
          <section className="card">
            <div className="btn-row">
              <label className="field"><span>Edges to generate</span>
                <select value={edges} onChange={(e) => setEdges(Number(e.target.value))} disabled={busy}>
                  {SIZES.map((s) => <option key={s} value={s}>{fmt(s)}</option>)}
                </select>
              </label>
              <label className="field"><span>Pregel concurrency</span>
                <select value={conc} onChange={(e) => setConc(Number(e.target.value))} disabled={busy}>
                  {[1, 2, 4].map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label className="field"><span>Stop when L1 change &lt;</span>
                <select value={eps} onChange={(e) => setEps(Number(e.target.value))} disabled={busy}>
                  {[1e-6, 1e-5, 1e-4, 1e-3].map((s) => <option key={s} value={s}>{s.toExponential(0)}</option>)}
                </select>
              </label>
              <label className="field"><span>Max iterations</span>
                <select value={maxIt} onChange={(e) => setMaxIt(Number(e.target.value))} disabled={busy}>
                  {[50, 100, 200, 500].map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <button className="btn primary big" disabled={busy} onClick={() => void go()}>▶ Generate {fmt(edges)} edges and run BreachRadar</button>
              <button className="btn" disabled={busy || runs.length === 0} onClick={() => void cleanup()}>Remove benchmark data</button>
            </div>
            <p className="hint">Concurrency above 4 needs a GDS licence key, so this demo caps it at 4. Generation goes through Cypher in batches and takes the longest; only the Pregel compute time reflects the algorithm. The convergence test sums |Δθ| over every bucket, so on millions of edges it needs a looser ε than on the small demo graph (1e-6).</p>
            {(busy || steps.length > 0) && (
              <div className="job">
                <div className="bar"><i style={{ width: `${Math.round(prog.frac * 100)}%` }} /></div>
                <div className="job-msg">{busy ? prog.msg : "Finished"}</div>
                <ul className="steps">{steps.map((s, i) => <li key={i} className="done"><span className="tick">✓</span>{s}</li>)}</ul>
              </div>
            )}
            {err && <div className="bad">{err}</div>}
          </section>

          {last && (
            <>
              <div className="stats">
                <Stat label="unique card–bucket edges" value={fmt(last.edges)} />
                <Stat label="nodes in the projection" value={fmt(last.nodes)} />
                <Stat label="Pregel compute" value={ms(last.computeMs)} tone="good" sub={`${fmt(Math.round((last.edges * 2 * last.supersteps) / Math.max(1, last.computeMs) * 1000))} edge visits / s`} />
                <Stat label="iterations" value={last.iterations} sub={`${last.supersteps} supersteps · ${last.converged ? "converged" : "max reached"}`} />
                <Stat label="projection" value={ms(last.projectMs)} />
                <Stat label="generation + ingestion" value={ms(last.genMs)} sub="Cypher, not the algorithm" />
              </div>
              <div className="grid2">
                <section className="card">
                  <h3>Runs in this session</h3>
                  <table className="tbl">
                    <thead><tr><th>#</th><th>edges</th><th>threads</th><th>generate</th><th>project</th><th>Pregel</th><th>iters</th></tr></thead>
                    <tbody>
                      {runs.map((r) => (
                        <tr key={r.id}><td>{r.id}</td><td>{fmt(r.edges)}</td><td>{r.concurrency}</td><td>{ms(r.genMs)}</td><td>{ms(r.projectMs)}</td><td><b>{ms(r.computeMs)}</b></td><td>{r.iterations}</td></tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="hint">Latest run, as reported by the procedure: pre-processing {ms(last.preMs)}, supersteps {ms(last.computeMs)}, post-processing {ms(last.postMs)}. Top bucket θ: {last.top[0] ? last.top[0].theta.toFixed(3) : "-"}.</p>
                </section>
                <section className="card">
                  <h3>Convergence of the latest run</h3>
                  <LineChart series={[{ name: "Σ|θ − θ_prev|", color: "#e11d48", points: last.deltas.map((d, i) => ({ x: i + 1, y: Math.max(d, 1e-12) })) }]} logY xLabel="iteration" yLabel="L1 change" height={240} hLine={{ y: eps, label: `ε = ${eps.toExponential(0)}` }} legend={false} />
                </section>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
