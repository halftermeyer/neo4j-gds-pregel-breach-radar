import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as db from "../lib/db";
import { generateDataset, type GenParams } from "../lib/gen";
import { getTerminals, invalidateCache } from "../lib/pipeline";
import { parseBucket } from "../lib/format";

export interface Job {
  kind: "ingest" | "reset" | null;
  running: boolean;
  msg: string;
  frac: number;
  log: string[];
  error?: string;
}

interface DemoCtx {
  env: db.EnvStatus | null;
  meta: db.DatasetMeta | null;
  refresh: () => Promise<void>;
  job: Job;
  ingest: (p: GenParams) => Promise<void>;
  reset: () => Promise<void>;
  bucketLabel: (id: string) => string;
  terminalName: (id: number) => string;
  goto: (tab: string) => void;
  /** Labelling defaults shared by the scenarios (stealing probability, noise, seed). */
  defaults: { p: number; noise: number; seed: number };
}

const Ctx = createContext<DemoCtx | null>(null);
export const useDemo = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("DemoProvider missing");
  return c;
};

const DEFAULTS = { p: 0.2, noise: 50, seed: 1 };

export function DemoProvider({ children, goto }: { children: ReactNode; goto: (t: string) => void }) {
  const [env, setEnv] = useState<db.EnvStatus | null>(null);
  const [meta, setMeta] = useState<db.DatasetMeta | null>(null);
  const [terms, setTerms] = useState<Map<number, string>>(new Map());
  const [job, setJob] = useState<Job>({ kind: null, running: false, msg: "", frac: 0, log: [] });
  const last = useRef("");

  const refresh = useCallback(async () => {
    const e = await db.getEnvStatus();
    setEnv(e);
    if (!e.connected) return;
    const m = await db.getMeta();
    setMeta(m);
    if (m.exists) {
      const t = await getTerminals();
      setTerms(new Map(t.map((x) => [x.id, x.name])));
    } else setTerms(new Map());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const log = (msg: string, frac: number, kind: Job["kind"]) =>
    setJob((j) => {
      const line = msg.replace(/\d[\d,]*( \/ [\d,]+)?/g, "#");
      const add = line !== last.current;
      last.current = line;
      return { ...j, kind, running: true, msg, frac, log: add ? [...j.log.slice(-40), msg] : j.log };
    });

  const ingest = useCallback(
    async (p: GenParams) => {
      setJob({ kind: "ingest", running: true, msg: "Clearing previous demo data", frac: 0, log: [] });
      try {
        await db.resetDemo();
        invalidateCache();
        const t0 = performance.now();
        const ds = generateDataset(p);
        log(`Generated ${ds.txs.length.toLocaleString()} transactions and ${ds.pocs.length} POCs in the browser (${Math.round(performance.now() - t0)} ms)`, 0, "ingest");
        await db.ingestDataset(ds, ds.pocs, (m, f) => log(m, f, "ingest"));
        await refresh();
        setJob((j) => ({ ...j, running: false, msg: "Dataset ready", frac: 1 }));
      } catch (e) {
        setJob((j) => ({ ...j, running: false, error: (e as Error).message }));
      }
    },
    [refresh],
  );

  const reset = useCallback(async () => {
    setJob({ kind: "reset", running: true, msg: "Deleting demo data and in-memory graphs", frac: 0.3, log: [] });
    try {
      await db.resetDemo();
      invalidateCache();
      await refresh();
      setJob({ kind: "reset", running: false, msg: "Database is empty again", frac: 1, log: [] });
    } catch (e) {
      setJob((j) => ({ ...j, running: false, error: (e as Error).message }));
    }
  }, [refresh]);

  const terminalName = useCallback((id: number) => terms.get(id) ?? `Terminal ${id}`, [terms]);
  const bucketLabel = useCallback(
    (id: string) => {
      const { terminal, week } = parseBucket(id);
      return `${terminalName(terminal)} · wk ${week}`;
    },
    [terminalName],
  );

  const value = useMemo<DemoCtx>(
    () => ({ env, meta, refresh, job, ingest, reset, bucketLabel, terminalName, goto, defaults: DEFAULTS }),
    [env, meta, refresh, job, ingest, reset, bucketLabel, terminalName, goto],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
