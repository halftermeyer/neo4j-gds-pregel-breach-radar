import { useEffect, useState } from "react";
import { useDemo } from "./Demo";
import { Stat } from "./Common";
import { DEFAULT_GEN, type GenParams } from "../lib/gen";
import { getTruth } from "../lib/db";
import { fmt } from "../lib/format";

type Truth = Awaited<ReturnType<typeof getTruth>>;

function DataModel() {
  const box = (x: number, y: number, label: string, sub: string, color: string, w = 120) => (
    <g>
      <rect x={x} y={y} width={w} height={44} rx={8} fill={color} />
      <text x={x + w / 2} y={y + 19} textAnchor="middle" className="dm-title">{label}</text>
      <text x={x + w / 2} y={y + 35} textAnchor="middle" className="dm-sub">{sub}</text>
    </g>
  );
  const arrow = (x1: number, y1: number, x2: number, y2: number, label: string, dashed = false, dy = -6) => (
    <g>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#475569" strokeWidth={1.6} strokeDasharray={dashed ? "5 4" : undefined} markerEnd="url(#arr)" />
      <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 + dy} textAnchor="middle" className="dm-rel">{label}</text>
    </g>
  );
  return (
    <svg viewBox="0 0 760 250" className="chart">
      <defs>
        <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" fill="#475569" />
        </marker>
      </defs>
      {box(10, 20, "Card", "id", "#0b297d")}
      {box(250, 20, "Transaction", "ts, amount, fraud", "#006fd6")}
      {box(500, 20, "Terminal", "id, name, size", "#00695c")}
      {box(250, 100, "Week", "id", "#8e24aa")}
      {box(10, 180, "Bucket", "terminal × week · n_j", "#e11d48", 150)}
      {arrow(130, 42, 250, 42, "PERFORMS")}
      {arrow(370, 42, 500, 42, "AT")}
      {arrow(310, 64, 310, 100, "IN_WEEK", false, 4)}
      {arrow(85, 180, 85, 64, "EXPOSED_AT {ts}", true, -4)}
      {arrow(160, 202, 500, 64, "OF_TERMINAL", true, 40)}
      {arrow(160, 195, 250, 135, "IN_WEEK", true, 18)}
      <text x={560} y={150} className="dm-note">Transaction Graph model:</text>
      <text x={560} y={168} className="dm-note">solid = raw transactions,</text>
      <text x={560} y={186} className="dm-note">dashed = derived bipartite layer</text>
      <text x={560} y={204} className="dm-note">(unique card–bucket pairs).</text>
    </svg>
  );
}

export default function SetupTab() {
  const { env, meta, job, ingest, reset } = useDemo();
  const [g, setG] = useState<GenParams>(DEFAULT_GEN);
  const [truth, setTruth] = useState<Truth | null>(null);
  const [showTruth, setShowTruth] = useState(false);
  const num = (k: keyof GenParams) => (e: React.ChangeEvent<HTMLInputElement>) => setG({ ...g, [k]: Number(e.target.value) });

  useEffect(() => {
    if (showTruth && meta?.exists) void getTruth().then(setTruth);
  }, [showTruth, meta]);

  const field = (k: keyof GenParams, label: string, step = 1) => (
    <label className="field">
      <span>{label}</span>
      <input type="number" value={g[k]} step={step} min={0} onChange={num(k)} disabled={job.running} />
    </label>
  );

  return (
    <div className="tab-body">
      <div className="grid2">
        <section className="card">
          <h3>Environment</h3>
          <ul className="checks">
            <li className={env?.connected ? "ok" : "ko"}>
              Neo4j {env?.connected ? "connected" : `unreachable ${env?.error ?? ""}`}
            </li>
            <li className={env?.gdsVersion ? "ok" : "ko"}>Graph Data Science {env?.gdsVersion ?? "not found"}</li>
            <li className={(env?.procedures.length ?? 0) >= 3 ? "ok" : "ko"}>
              BreachRadar plugin: {(env?.procedures ?? []).join(", ") || "not loaded (run make plugin)"}
            </li>
          </ul>
          <p className="hint">
            The algorithm is a custom <b>GDS Pregel</b> procedure packaged as a plugin jar that sits next to GDS. It needs a self-managed Neo4j with GDS
            (the Pregel Java API is not exposed by Neo4j Graph Analytics serverless, so the algorithm is kept isolated in <code>plugin/</code>).
          </p>
        </section>

        <section className="card">
          <h3>Synthetic dataset</h3>
          <p className="hint">All data is synthetic and generated here, in the browser, then ingested into Neo4j. Ground truth stays known for scoring.</p>
          <div className="fields">
            {field("cards", "Cards")}
            {field("terminals", "Terminals")}
            {field("weeks", "Weeks")}
            {field("txPerCardWeek", "Tx / card / week", 0.1)}
            {field("breachPocs", "Data breaches (3 wk)")}
            {field("skimmerPocs", "Skimmers (1 wk)")}
            {field("seed", "Seed")}
          </div>
          <div className="btn-row">
            <button className="btn primary" disabled={job.running || !env?.connected || (env?.procedures.length ?? 0) < 3} onClick={() => void ingest(g)}>
              {meta?.exists ? "Regenerate and re-ingest" : "Generate and ingest"}
            </button>
            <button className="btn" disabled={job.running || !env?.connected} onClick={() => void reset()}>Reset demo (empty database)</button>
          </div>
          {(job.running || job.log.length > 0 || job.error) && (
            <div className="job">
              <div className="bar"><i style={{ width: `${Math.round(job.frac * 100)}%` }} /></div>
              <div className="job-msg">{job.error ? <span className="bad">{job.error}</span> : job.msg}</div>
              <pre className="log">{job.log.join("\n")}</pre>
            </div>
          )}
        </section>
      </div>

      {meta?.exists && (
        <section className="card">
          <h3>What is in the graph now</h3>
          <div className="stats">
            <Stat label="cards" value={fmt(meta.cards)} />
            <Stat label="terminals" value={fmt(meta.terminals)} />
            <Stat label="weeks" value={fmt(meta.weeks)} />
            <Stat label="transactions" value={fmt(meta.transactions)} />
            <Stat label="buckets (terminal × week)" value={fmt(meta.buckets)} />
            <Stat label="unique card–bucket edges" value={fmt(meta.edges)} />
            <Stat label="injected POCs" value={meta.pocs} sub={`${meta.pocBuckets} buckets`} />
          </div>
          <DataModel />
        </section>
      )}

      {meta?.exists && (
        <section className="card">
          <h3>Ground truth <small>(kept for scoring; never read by the algorithm)</small></h3>
          <button className="btn" onClick={() => setShowTruth(!showTruth)}>{showTruth ? "Hide" : "Reveal"} the injected POCs</button>
          {showTruth && truth && (
            <table className="tbl">
              <thead><tr><th>POC</th><th>type</th><th>terminal</th><th>weeks</th></tr></thead>
              <tbody>
                {truth.pocs.map((p) => (
                  <tr key={p.id}><td>{p.id}</td><td>{p.type === "breach" ? "data breach" : "skimmer"}</td><td>T{p.terminal}</td><td>{p.weekStart === p.weekEnd ? p.weekStart : `${p.weekStart}–${p.weekEnd}`}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      <section className="card">
        <h3>The algorithm in one paragraph</h3>
        <p>
          BreachRadar (Araujo et al., SDM 2017) works on a bipartite graph: <b>cards</b> on one side, <b>buckets</b> (a terminal in a given week) on the other.
          Each fraud-card spreads one unit of blame over the buckets it visited, in proportion to how likely each bucket is to be compromised
          (<code>b<sub>ij</sub> = θ<sub>j</sub> / Σ<sub>k</sub> θ<sub>k</sub></code>), so a card blames <i>one</i> location overall. Each bucket then updates its probability
          <code> θ<sub>j</sub> = (z<sub>j</sub> + α) / (n<sub>j</sub> + α + β)</code> with <code>z<sub>j</sub></code> the blame it received, <code>n<sub>j</sub></code> all its cards (fraud or not),
          α = 0.2, β = 15. Start from uniform blame and alternate until the L1 change of θ drops below ε. Only buckets with at least 5 fraud-cards are kept.
        </p>
        <p className="hint">Portability: custom Pregel needs the self-managed GDS Java API. Neo4j Graph Analytics (serverless) may not run custom Pregel procedures, so check that before promising it there.</p>
      </section>
    </div>
  );
}
