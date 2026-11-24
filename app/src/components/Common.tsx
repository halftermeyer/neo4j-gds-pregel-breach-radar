import type { ReactNode } from "react";
import { useDemo } from "./Demo";
import type { Step } from "../lib/pipeline";
import { ms } from "../lib/format";

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "good" | "bad" | "warn" }) {
  return (
    <div className={`stat ${tone ?? ""}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export function ScenarioHead({ n, title, pitch }: { n: number; title: string; pitch: string }) {
  return (
    <div className="scenario-head">
      <span className="scenario-no">{n}</span>
      <div>
        <h2>{title}</h2>
        <p>{pitch}</p>
      </div>
    </div>
  );
}

/** The synthetic visual statement of the business problem that opens every scenario. */
export function ProblemBanner({ title, children, caption }: { title: string; children: ReactNode; caption?: ReactNode }) {
  return (
    <section className="problem">
      <div className="problem-tag">The business problem</div>
      <h3>{title}</h3>
      <div className="problem-visual">{children}</div>
      {caption && <p className="problem-caption">{caption}</p>}
    </section>
  );
}

export function NeedsData({ children }: { children: ReactNode }) {
  const { meta, env, goto } = useDemo();
  if (!env) return <div className="empty">Connecting to Neo4j…</div>;
  if (!env.connected)
    return (
      <div className="empty bad">
        <h3>Cannot reach Neo4j</h3>
        <p>{env.error}</p>
        <p>Start it with <code>make up</code> and check the NEO4J_* keys in <code>.env</code>.</p>
      </div>
    );
  if (env.procedures.length < 3)
    return (
      <div className="empty bad">
        <h3>The BreachRadar plugin is not loaded</h3>
        <p>Run <code>make plugin</code> to build the jar, copy it next to GDS and restart the container.</p>
      </div>
    );
  if (!meta?.exists)
    return (
      <div className="empty">
        <h3>The database is empty</h3>
        <p>The demo generates its own synthetic data from inside the app.</p>
        <button className="btn primary" onClick={() => goto("setup")}>Go to Setup and generate the dataset</button>
      </div>
    );
  return <>{children}</>;
}

export function StepList({ steps, running, current }: { steps: Step[]; running: boolean; current?: string }) {
  return (
    <ul className="steps">
      {steps.map((s, i) => (
        <li key={i} className="done"><span className="tick">✓</span>{s.label}<b>{ms(s.ms)}</b></li>
      ))}
      {running && <li className="active"><span className="spin" />{current ?? "Working…"}</li>}
    </ul>
  );
}

export function Slider(p: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; format: (v: number) => string; onCommit?: () => void; disabled?: boolean }) {
  return (
    <label className="slider">
      <span>{p.label}</span>
      <input
        type="range"
        min={p.min}
        max={p.max}
        step={p.step}
        value={p.value}
        disabled={p.disabled}
        onChange={(e) => p.onChange(Number(e.target.value))}
        onMouseUp={p.onCommit}
        onTouchEnd={p.onCommit}
        onKeyUp={p.onCommit}
      />
      <b>{p.format(p.value)}</b>
    </label>
  );
}

export function Sim({ children }: { children: ReactNode }) {
  return <div className="sim-badge">{children}</div>;
}
