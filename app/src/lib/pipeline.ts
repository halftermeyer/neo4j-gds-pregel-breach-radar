// The detection pipeline, step by step. Every step is a Cypher statement or a GDS/Pregel call (visible in the audit drawer).
import { withGroup } from "./neo4j.ts";
import * as db from "./db.ts";
import { MIN_FRAUD_CARDS, type BucketStat } from "./eval.ts";
import { sampleLabels, MIN_PER_WEEK, type Exposure } from "./gen.ts";

// All pipeline runs mutate shared database state (labels, f_j, theta, the in-memory graph): run them one at a time.
let chain: Promise<unknown> = Promise.resolve();
export function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined);
  return next;
}

export interface RunParams {
  p: number;
  noise: number; // % of compromised fraud cards
  cutoffWeek: number; // decision time = end of this week (weeks = all data)
  seed: number;
  snapshots?: boolean; // also replay theta iteration by iteration (extra Pregel runs)
  neighbourhoods?: number; // fetch the fraud-card neighbourhood of the top-N buckets (blame-flow view)
  reissue?: boolean; // fetch the data of the reissue simulation (scenario 4)
}

export interface Step {
  label: string;
  ms: number;
}

export interface RunResult {
  params: RunParams;
  steps: Step[];
  totalMs: number;
  summary: db.BreachRadarSummary;
  buckets: BucketStat[]; // buckets with >= 5 fraud-cards, theta from Pregel
  truth: Set<string>;
  edges: [number, string][];
  fraudCards: number;
  keptBuckets: number;
  projected: { nodeCount: number; relationshipCount: number };
  snapshots?: { k: number; theta: Map<string, number> }[];
  neighbourhoods?: Map<string, db.BucketCard[]>;
  reissue?: db.ReissueData;
}

export interface RawResult {
  buckets: BucketStat[]; // every bucket with >= 1 fraud-card (no pruning), what an analyst's pivot table would rank
  truth: Set<string>;
  fraudCards: number;
  steps: Step[];
}

export async function getTerminals(): Promise<db.TerminalInfo[]> {
  if (!terminalCache) terminalCache = await db.getAllTerminals();
  return terminalCache;
}

/** Scenario 1: load the fraud feed and return the raw per-bucket counts. No algorithm involved. */
export function loadRaw(rp: Pick<RunParams, "p" | "noise" | "cutoffWeek" | "seed">): Promise<RawResult> {
  return exclusive(() =>
    withGroup(`Load fraud feed — p=${Math.round(rp.p * 100)}%, noise=+${rp.noise}%`, async () => {
      const steps: Step[] = [];
      await ensureLabels(rp.p, rp.noise, rp.seed, steps);
      const cutoff = Math.min(rp.cutoffWeek, meta!.weeks) * MIN_PER_WEEK;
      const prep = await timed(steps, "Count fraud-cards per bucket", () => db.prepareBuckets(cutoff));
      const [buckets, truth] = await Promise.all([db.getBucketStats(1), db.getTruth()]);
      return { buckets, truth: new Set(truth.buckets), fraudCards: prep.fraudCards, steps };
    }),
  );
}

let terminalCache: db.TerminalInfo[] | null = null;
let exposures: Exposure[] | null = null;
let currentLabel: { p: number; noise: number } | null = null;
let meta: { cards: number; terminals: number; weeks: number } | null = null;

export function invalidateCache() {
  terminalCache = null;
  exposures = null;
  currentLabel = null;
  meta = null;
}

async function timed<T>(steps: Step[], label: string, fn: () => Promise<T>): Promise<T> {
  const t = performance.now();
  const r = await fn();
  steps.push({ label, ms: Math.round(performance.now() - t) });
  return r;
}

export async function ensureLabels(p: number, noise: number, seed: number, steps: Step[] = []) {
  if (!meta) {
    const m = await db.getMeta();
    meta = { cards: m.cards, terminals: m.terminals, weeks: m.weeks };
    currentLabel = m.label ?? null;
  }
  if (currentLabel && currentLabel.p === p && currentLabel.noise === noise) return;
  if (!exposures) exposures = await db.getPocExposures();
  const labels = sampleLabels(exposures, meta.cards, meta.terminals, meta.weeks, { p, noisePct: noise, seed });
  await timed(steps, `Label fraud (p=${Math.round(p * 100)}%, noise=+${noise}%)`, () => db.writeLabels(labels.fraudTx, { p, noise }));
  currentLabel = { p, noise };
}

export function runPipeline(rp: RunParams, onStep?: (s: string) => void): Promise<RunResult> {
  return exclusive(() => runPipelineInner(rp, onStep));
}

async function runPipelineInner(rp: RunParams, onStep?: (s: string) => void): Promise<RunResult> {
  const steps: Step[] = [];
  const t0 = performance.now();
  return withGroup(`BreachRadar run — p=${Math.round(rp.p * 100)}%, noise=+${rp.noise}%`, async () => {
    onStep?.("Sampling and writing fraud labels");
    await ensureLabels(rp.p, rp.noise, rp.seed, steps);
    const weeks = meta!.weeks;
    const cutoff = Math.min(rp.cutoffWeek, weeks) * MIN_PER_WEEK;
    onStep?.("Counting fraud-cards per bucket (keep >= 5)");
    const prep = await timed(steps, "Prepare buckets (f_j, keep >= 5 fraud-cards)", () => db.prepareBuckets(cutoff));
    onStep?.("Projecting bipartite graph into GDS");
    const proj = await timed(steps, "Project bipartite graph (gds.graph.project)", () => db.projectGraph(cutoff));
    onStep?.("Running BreachRadar (GDS Pregel)");
    const summary = await timed(steps, "breachradar.pregel.write", () => db.runBreachRadarWrite());
    onStep?.("Reading results");
    const [buckets, truthRows, edges] = await Promise.all([
      timed(steps, "Read bucket scores", () => db.getBucketStats(MIN_FRAUD_CARDS)),
      db.getTruth(),
      timed(steps, "Read fraud-card edges (for greedy baseline)", () => db.getFraudEdges(cutoff)),
    ]);
    let snapshots: RunResult["snapshots"];
    if (rp.snapshots) {
      onStep?.("Replaying iterations");
      const ks = Array.from(new Set([0, 1, 2, 3, 5, 8, 12, 20, summary.iterations])).filter((k) => k <= summary.iterations).sort((a, b) => a - b);
      snapshots = [];
      await timed(steps, `Replay ${ks.length} iteration snapshots (Pregel stream)`, async () => {
        for (const k of ks) snapshots!.push({ k, theta: await db.streamThetaAt(k) });
      });
    }
    let neighbourhoods: RunResult["neighbourhoods"];
    if (rp.neighbourhoods) {
      onStep?.("Fetching blame neighbourhoods of the top buckets");
      neighbourhoods = new Map();
      const top = [...buckets].sort((a, b) => (b.theta ?? 0) - (a.theta ?? 0)).slice(0, rp.neighbourhoods);
      await timed(steps, `Read fraud-card neighbourhoods of the top ${top.length} buckets`, async () => {
        for (const b of top) neighbourhoods!.set(b.id, await db.getBucketNeighbourhood(b.id, cutoff, 30));
      });
    }
    let reissue: db.ReissueData | undefined;
    if (rp.reissue) {
      onStep?.("Reading cards and later fraud for the reissue simulation");
      reissue = await timed(steps, "Reissue simulation inputs", () => db.getReissueData(cutoff));
    }
    return {
      params: rp,
      steps,
      totalMs: Math.round(performance.now() - t0),
      summary,
      buckets,
      truth: new Set(truthRows.buckets),
      edges,
      fraudCards: prep.fraudCards,
      keptBuckets: prep.kept,
      projected: proj,
      snapshots,
      neighbourhoods,
      reissue,
    };
  });
}
