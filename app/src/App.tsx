import { useState } from "react";
import { Tabs } from "@neo4j-ndl/react";
import { DemoProvider, useDemo } from "./components/Demo";
import SetupTab from "./components/SetupTab";
import Scenario1 from "./components/Scenario1";
import Scenario2 from "./components/Scenario2";
import Scenario3 from "./components/Scenario3";
import Scenario4 from "./components/Scenario4";
import Scenario5 from "./components/Scenario5";
import QueryAuditDrawer from "./components/QueryAuditDrawer";
import "./App.css";

function Header() {
  const { env, meta, reset, job } = useDemo();
  return (
    <header className="app-header">
      <div className="header-content">
        <div>
          <h1><span className="header-icon">&#9906;</span> BreachRadar · Point-of-Compromise detection</h1>
          <p className="subtitle">Which merchant leaked the cards? A custom GDS Pregel algorithm on a Neo4j transaction graph. All data is synthetic.</p>
        </div>
        <div className="header-status">
          <span className={`pill ${env?.connected ? "ok" : "ko"}`}>Neo4j {env?.connected ? "connected" : "offline"}</span>
          {env?.gdsVersion && <span className="pill ok">GDS {env.gdsVersion}</span>}
          <span className={`pill ${(env?.procedures.length ?? 0) >= 3 ? "ok" : "ko"}`}>Pregel plugin {(env?.procedures.length ?? 0) >= 3 ? "loaded" : "missing"}</span>
          {meta?.exists && <span className="pill">{meta.cards.toLocaleString()} cards · {meta.transactions.toLocaleString()} tx</span>}
          <button className="btn small" disabled={job.running || !env?.connected} onClick={() => void reset()}>Reset demo</button>
        </div>
      </div>
    </header>
  );
}

const TABS: [string, string][] = [
  ["s1", "1 · The problem"],
  ["s2", "2 · BreachRadar live"],
  ["s3", "3 · Early detection"],
  ["s4", "4 · Business value"],
  ["s5", "5 · Scale"],
  ["setup", "Setup & model"],
];

function Shell({ active }: { active: string }) {
  // All tabs stay mounted so results survive tab switches; only the active one is visible.
  const show = (id: string) => ({ display: active === id ? "block" : "none" });
  return (
    <main className="app-main">
      <div style={show("s1")}><Scenario1 /></div>
      <div style={show("s2")}><Scenario2 /></div>
      <div style={show("s3")}><Scenario3 /></div>
      <div style={show("s4")}><Scenario4 /></div>
      <div style={show("s5")}><Scenario5 /></div>
      <div style={show("setup")}><SetupTab /></div>
    </main>
  );
}

function App() {
  const [active, setActive] = useState("setup");
  return (
    <DemoProvider goto={setActive}>
      <div className="app-container">
        <Header />
        <div className="app-tabs">
          <Tabs fill="underline" onChange={(v) => setActive(String(v))} value={active}>
            {TABS.map(([id, label]) => (
              <Tabs.Tab key={id} id={id}>{label}</Tabs.Tab>
            ))}
          </Tabs>
        </div>
        <Shell active={active} />
        <QueryAuditDrawer />
      </div>
    </DemoProvider>
  );
}

export default App;
