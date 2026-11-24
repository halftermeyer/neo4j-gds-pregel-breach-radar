// Typed Cypher query functions. Every call goes through runQuery(), so every statement shows up in the Query Audit Drawer.
import { runQuery, withGroup } from "./neo4j.ts";
import { bucketId, type Dataset, type FraudTx, type GenParams, type Exposure, pocBuckets } from "./gen.ts";
import { MIN_FRAUD_CARDS, type BucketStat } from "./eval.ts";

const GRAPH = "br";
export const DEMO_LABELS = ["Card", "Terminal", "Week", "Transaction", "Bucket", "Poc", "Dataset", "FraudTx", "FraudCard"];
const CHUNK = 5000;

const chunks = <T,>(a: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n));
  return out;
};

// ───────────────────────── status ─────────────────────────

export interface EnvStatus {
  connected: boolean;
  error?: string;
  gdsVersion?: string;
  procedures: string[];
}

export async function getEnvStatus(): Promise<EnvStatus> {
  try {
    const v = await runQuery<{ v: string }>("RETURN gds.version() AS v").catch(() => [{ v: undefined as unknown as string }]);
    const p = await runQuery<{ procs: string[] }>(
      "SHOW PROCEDURES YIELD name WHERE name STARTS WITH 'breachradar.pregel' RETURN collect(name) AS procs",
    );
    return { connected: true, gdsVersion: v[0]?.v, procedures: p[0]?.procs ?? [] };
  } catch (e) {
    return { connected: false, error: (e as Error).message, procedures: [] };
  }
}

export interface DatasetMeta {
  exists: boolean;
  params?: GenParams;
  cards: number;
  terminals: number;
  weeks: number;
  transactions: number;
  buckets: number;
  edges: number;
  pocs: number;
  pocBuckets: number;
  label?: { p: number; noise: number };
}

export async function getMeta(): Promise<DatasetMeta> {
  const rows = await runQuery<Record<string, unknown>>(`
    OPTIONAL MATCH (d:Dataset {id:'main'})
    CALL () { MATCH (c:Card) RETURN count(c) AS cards }
    CALL () { MATCH (t:Terminal) RETURN count(t) AS terminals }
    CALL () { MATCH (w:Week) RETURN count(w) AS weeks }
    CALL () { MATCH (x:Transaction) RETURN count(x) AS transactions }
    CALL () { MATCH (b:Bucket) RETURN count(b) AS buckets }
    CALL () { MATCH ()-[e:EXPOSED_AT]->() RETURN count(e) AS edges }
    CALL () { MATCH (g:Poc) RETURN count(g) AS pocs }
    CALL () { MATCH (b:Bucket {poc:true}) RETURN count(b) AS pocBuckets }
    RETURN d.params AS params, d.label AS label, cards, terminals, weeks, transactions, buckets, edges, pocs, pocBuckets`);
  const r = rows[0];
  const cards = Number(r.cards);
  return {
    exists: cards > 0 && r.params != null,
    params: r.params ? (JSON.parse(r.params as string) as GenParams) : undefined,
    label: r.label ? (JSON.parse(r.label as string) as { p: number; noise: number }) : undefined,
    cards,
    terminals: Number(r.terminals),
    weeks: Number(r.weeks),
    transactions: Number(r.transactions),
    buckets: Number(r.buckets),
    edges: Number(r.edges),
    pocs: Number(r.pocs),
    pocBuckets: Number(r.pocBuckets),
  };
}

// ───────────────────────── reset ─────────────────────────

/** Remove everything the demo created (demo labels only) and drop in-memory graphs. */
export async function resetDemo(): Promise<void> {
  await withGroup("Reset demo", async () => {
    for (const g of [GRAPH, "br_bench"]) await runQuery("CALL gds.graph.drop($name, false) YIELD graphName RETURN graphName", { name: g });
    await runQuery(
      `MATCH (n) WHERE any(l IN labels(n) WHERE l IN $labels OR l STARTS WITH 'Bench')
       CALL (n) { DETACH DELETE n } IN TRANSACTIONS OF 20000 ROWS`,
      { labels: DEMO_LABELS },
    );
    await dropSchema();
  });
}

const SCHEMA = [
  "CREATE CONSTRAINT card_id IF NOT EXISTS FOR (n:Card) REQUIRE n.id IS UNIQUE",
  "CREATE CONSTRAINT terminal_id IF NOT EXISTS FOR (n:Terminal) REQUIRE n.id IS UNIQUE",
  "CREATE CONSTRAINT week_id IF NOT EXISTS FOR (n:Week) REQUIRE n.id IS UNIQUE",
  "CREATE CONSTRAINT tx_id IF NOT EXISTS FOR (n:Transaction) REQUIRE n.id IS UNIQUE",
  "CREATE CONSTRAINT bucket_id IF NOT EXISTS FOR (n:Bucket) REQUIRE n.id IS UNIQUE",
];

async function dropSchema(): Promise<void> {
  for (const n of ["card_id", "terminal_id", "week_id", "tx_id", "bucket_id"]) await runQuery(`DROP CONSTRAINT ${n} IF EXISTS`);
}

// ───────────────────────── ingestion (Transaction Graph model) ─────────────────────────
//   (:Card)-[:PERFORMS]->(:Transaction)-[:AT]->(:Terminal), (:Transaction)-[:IN_WEEK]->(:Week)
//   derived: (:Bucket = terminal x week)-[:OF_TERMINAL|IN_WEEK]->..., (:Card)-[:EXPOSED_AT {ts}]->(:Bucket)  (unique pairs)

export type Progress = (msg: string, fraction: number) => void;

export async function ingestDataset(ds: Dataset, pocs: Dataset["pocs"], progress: Progress): Promise<void> {
  const { params } = ds;
  await withGroup("Ingest synthetic dataset", async () => {
    progress("Creating constraints", 0.01);
    for (const q of SCHEMA) await runQuery(q);
    progress("Terminals and weeks", 0.03);
    await runQuery(
      "UNWIND $rows AS r CREATE (:Terminal {id:r.id, name:r.name, size:r.size, popularity:r.popularity})",
      { rows: ds.terminals },
    );
    await runQuery("UNWIND range(0, $weeks - 1) AS w CREATE (:Week {id:w, startMinute: w * 10080})", { weeks: params.weeks });
    progress("Cards", 0.05);
    for (const c of chunks(Array.from({ length: params.cards }, (_, i) => i), 20000))
      await runQuery("UNWIND $ids AS id CREATE (:Card {id:id, n:0.0})", { ids: c });
    const batches = chunks(ds.txs, CHUNK);
    for (let i = 0; i < batches.length; i++) {
      progress(`Transactions ${Math.min((i + 1) * CHUNK, ds.txs.length).toLocaleString()} / ${ds.txs.length.toLocaleString()}`, 0.08 + 0.6 * ((i + 1) / batches.length));
      await runQuery(
        `UNWIND $rows AS r
         MATCH (c:Card {id:r.card}), (t:Terminal {id:r.terminal}), (w:Week {id:r.week})
         CREATE (x:Transaction {id:r.id, ts:r.ts, amount:r.amount, fraud:false})
         CREATE (c)-[:PERFORMS]->(x)-[:AT]->(t)
         CREATE (x)-[:IN_WEEK]->(w)`,
        { rows: batches[i] },
      );
    }
    progress("Deriving buckets and unique card-bucket edges", 0.7);
    const slab = 500;
    for (let lo = 0; lo < params.cards; lo += slab) {
      progress(`Deriving card-bucket edges (cards ${lo}–${Math.min(lo + slab, params.cards)})`, 0.7 + 0.2 * (lo / params.cards));
      await runQuery(
        `UNWIND range($lo, $hi) AS cid
         MATCH (c:Card {id:cid})-[:PERFORMS]->(x:Transaction)-[:AT]->(t:Terminal), (x)-[:IN_WEEK]->(w:Week)
         WITH c, t, w, min(x.ts) AS ts            // one edge per (card, bucket): multi-edges removed here
         MERGE (b:Bucket {id: 'T' + right('000' + toString(t.id), 3) + '-W' + right('00' + toString(w.id), 2)})
           ON CREATE SET b.terminal = t.id, b.week = w.id, b.n = 0.0, b.f = 0, b.poc = false
         CREATE (c)-[:EXPOSED_AT {ts: ts}]->(b)`,
        { lo, hi: Math.min(lo + slab, params.cards) - 1 },
      );
    }
    progress("Precomputing n_j (cards per bucket, fraud or not)", 0.92);
    await runQuery("MATCH (b:Bucket) SET b.n = toFloat(count { (b)<-[:EXPOSED_AT]-() })");
    await runQuery(
      `MATCH (b:Bucket) MATCH (t:Terminal {id:b.terminal}), (w:Week {id:b.week})
       CREATE (b)-[:OF_TERMINAL]->(t), (b)-[:IN_WEEK]->(w)`,
    );
    progress("Injecting ground-truth POCs", 0.96);
    await runQuery(
      `UNWIND $pocs AS p
       CREATE (g:Poc {id:p.id, type:p.type, terminal:p.terminal, weekStart:p.weekStart, weekEnd:p.weekEnd})
       WITH g, p UNWIND p.buckets AS bid
       MATCH (b:Bucket {id:bid})
       SET b.poc = true
       CREATE (g)-[:COMPROMISED]->(b)`,
      { pocs: pocs.map((p) => ({ ...p, buckets: pocBuckets([p]) })) },
    );
    await runQuery("MERGE (d:Dataset {id:'main'}) SET d.params = $params, d.createdAt = datetime()", { params: JSON.stringify(params) });
    progress("Done", 1);
  });
}

// ───────────────────────── fraud labelling ─────────────────────────

/** Exposures of all cards at the injected POC buckets (input of the stealing-probability sampler). */
export async function getPocExposures(): Promise<Exposure[]> {
  const rows = await runQuery<{ card: number; bucket: string; ts: number }>(
    `MATCH (b:Bucket {poc:true})<-[e:EXPOSED_AT]-(c:Card)
     RETURN c.id AS card, b.id AS bucket, e.ts AS ts`,
  );
  return rows;
}

export async function writeLabels(fraudTx: FraudTx[], label: { p: number; noise: number }): Promise<void> {
  await withGroup(`Label fraud (p=${label.p}, noise=${label.noise}%)`, async () => {
    await runQuery("MATCH (x:FraudTx) CALL (x) { DETACH DELETE x } IN TRANSACTIONS OF 20000 ROWS");
    await runQuery("MATCH (c:FraudCard) CALL (c) { REMOVE c:FraudCard, c.firstFraudTs } IN TRANSACTIONS OF 20000 ROWS");
    for (const b of chunks(fraudTx, CHUNK))
      await runQuery(
        `UNWIND $rows AS r
         MATCH (c:Card {id:r.card}), (t:Terminal {id:r.terminal}), (w:Week {id:r.week})
         CREATE (x:Transaction:FraudTx {id:r.id, ts:r.ts, amount:r.amount, fraud:true, source:r.source})
         CREATE (c)-[:PERFORMS]->(x)-[:AT]->(t)
         CREATE (x)-[:IN_WEEK]->(w)`,
        { rows: b },
      );
    // A fraud-card = a card with at least one fraudulent transaction; remember when its first one happened.
    await runQuery(
      `MATCH (c:Card)-[:PERFORMS]->(x:FraudTx)
       WITH c, min(x.ts) AS firstFraud
       SET c:FraudCard, c.firstFraudTs = firstFraud`,
    );
    await runQuery("MATCH (d:Dataset {id:'main'}) SET d.label = $label", { label: JSON.stringify(label) });
  });
}

// ───────────────────────── projection + algorithm ─────────────────────────

/** Fraud-cards known at `cutoff` (minutes) and their buckets observed BEFORE their first fraud; keep buckets with >= 5 fraud-cards. */
export async function prepareBuckets(cutoff: number): Promise<{ kept: number; fraudCards: number; edges: number }> {
  await runQuery("MATCH (b:Bucket) WHERE b.f > 0 OR b.theta IS NOT NULL SET b.f = 0, b.theta = null");
  await runQuery(
    `MATCH (c:FraudCard)-[e:EXPOSED_AT]->(b:Bucket)
     WHERE c.firstFraudTs <= $cutoff AND e.ts < c.firstFraudTs
     WITH b, count(c) AS f
     SET b.f = f`,
    { cutoff },
  );
  const r = await runQuery<{ kept: number; fraudCards: number; edges: number }>(
    `CALL () { MATCH (b:Bucket) WHERE b.f >= $min RETURN count(b) AS kept }
     CALL () { MATCH (c:FraudCard) WHERE c.firstFraudTs <= $cutoff RETURN count(c) AS fraudCards }
     CALL () { MATCH (c:FraudCard)-[e:EXPOSED_AT]->(b:Bucket) WHERE c.firstFraudTs <= $cutoff AND e.ts < c.firstFraudTs AND b.f >= $min RETURN count(e) AS edges }
     RETURN kept, fraudCards, edges`,
    { cutoff, min: MIN_FRAUD_CARDS },
  );
  return r[0];
}

export async function projectGraph(cutoff: number): Promise<{ nodeCount: number; relationshipCount: number; projectMillis: number }> {
  await runQuery("CALL gds.graph.drop($name, false) YIELD graphName RETURN graphName", { name: GRAPH });
  const r = await runQuery<{ nodeCount: number; relationshipCount: number; projectMillis: number }>(
    `MATCH (c:FraudCard)-[e:EXPOSED_AT]->(b:Bucket)
     WHERE c.firstFraudTs <= $cutoff AND e.ts < c.firstFraudTs AND b.f >= $min
     WITH gds.graph.project($name, c, b,
          { sourceNodeLabels: ['Victim'], targetNodeLabels: ['Cause'],
            sourceNodeProperties: { n: 0.0 }, targetNodeProperties: b { .n },
            relationshipType: 'EXPOSED_AT' },
          { undirectedRelationshipTypes: ['*'] }) AS g
     RETURN g.nodeCount AS nodeCount, g.relationshipCount AS relationshipCount, g.projectMillis AS projectMillis`,
    { cutoff, min: MIN_FRAUD_CARDS, name: GRAPH },
  );
  return r[0];
}

export interface BreachRadarSummary {
  nodeCount: number;
  causeCount: number;
  victimCount: number;
  iterations: number;
  supersteps: number;
  didConverge: boolean;
  finalDelta: number;
  deltas: number[];
  preProcessingMillis: number;
  computeMillis: number;
  postProcessingMillis: number;
  nodePropertiesWritten: number;
}

export interface AlgoConfig {
  alpha: number;
  beta: number;
  epsilon: number;
  maxIterations: number;
  concurrency: number;
}
export const DEFAULT_ALGO: AlgoConfig = { alpha: 0.2, beta: 15, epsilon: 1e-6, maxIterations: 100, concurrency: 4 };

/** Run the custom Pregel procedure in write mode: theta_j lands on the Bucket nodes. */
export async function runBreachRadarWrite(cfg: AlgoConfig = DEFAULT_ALGO, graph = GRAPH): Promise<BreachRadarSummary> {
  const r = await runQuery<BreachRadarSummary>(
    `CALL breachradar.pregel.write($graph, $cfg)
     YIELD nodeCount, causeCount, victimCount, iterations, supersteps, didConverge, finalDelta, deltas,
           preProcessingMillis, computeMillis, postProcessingMillis, nodePropertiesWritten
     RETURN nodeCount, causeCount, victimCount, iterations, supersteps, didConverge, finalDelta, deltas,
            preProcessingMillis, computeMillis, postProcessingMillis, nodePropertiesWritten`,
    { graph, cfg: { ...cfg, populationProperty: "n", writeProperty: "theta", user: "neo4j" } },
  );
  return r[0];
}

/** Stream theta after at most `iterations` theta-updates (used to replay the convergence iteration by iteration). */
export async function streamThetaAt(iterations: number, cfg: AlgoConfig = DEFAULT_ALGO): Promise<Map<string, number>> {
  const rows = await runQuery<{ id: string; theta: number }>(
    `CALL breachradar.pregel.stream($graph, $cfg) YIELD nodeId, theta
     RETURN gds.util.asNode(nodeId).id AS id, theta`,
    { graph: GRAPH, cfg: { ...cfg, maxIterations: iterations, populationProperty: "n", user: "neo4j" } },
  );
  return new Map(rows.map((r) => [r.id, r.theta]));
}

// ───────────────────────── results ─────────────────────────

export async function getBucketStats(minFraud: number): Promise<BucketStat[]> {
  return runQuery<BucketStat>(
    `MATCH (b:Bucket) WHERE b.f >= $min
     RETURN b.id AS id, b.n AS n, b.f AS f, b.poc AS poc, b.theta AS theta`,
    { min: minFraud },
  );
}

export async function getFraudEdges(cutoff: number): Promise<[number, string][]> {
  const rows = await runQuery<{ card: number; bucket: string }>(
    `MATCH (c:FraudCard)-[e:EXPOSED_AT]->(b:Bucket)
     WHERE c.firstFraudTs <= $cutoff AND e.ts < c.firstFraudTs AND b.f >= $min
     RETURN c.id AS card, b.id AS bucket`,
    { cutoff, min: MIN_FRAUD_CARDS },
  );
  return rows.map((r) => [r.card, r.bucket]);
}

export async function getTruth(): Promise<{ buckets: string[]; pocs: { id: string; type: string; terminal: number; weekStart: number; weekEnd: number }[] }> {
  const buckets = await runQuery<{ id: string }>("MATCH (b:Bucket {poc:true}) RETURN b.id AS id ORDER BY id");
  const pocs = await runQuery<{ id: string; type: string; terminal: number; weekStart: number; weekEnd: number }>(
    "MATCH (g:Poc) RETURN g.id AS id, g.type AS type, g.terminal AS terminal, g.weekStart AS weekStart, g.weekEnd AS weekEnd ORDER BY id",
  );
  return { buckets: buckets.map((b) => b.id), pocs };
}

export interface BucketCard {
  card: number;
  buckets: { id: string; theta: number; n: number; f: number }[];
}

/** Fraud-cards of one bucket with every candidate bucket they could blame (for the blame-flow view). */
export async function getBucketNeighbourhood(bucket: string, cutoff: number, limitCards = 40): Promise<BucketCard[]> {
  return runQuery<BucketCard>(
    `MATCH (b:Bucket {id:$bucket})<-[e:EXPOSED_AT]-(c:FraudCard)
     WHERE c.firstFraudTs <= $cutoff AND e.ts < c.firstFraudTs
     WITH c ORDER BY c.id LIMIT $limit
     MATCH (c)-[e2:EXPOSED_AT]->(o:Bucket)
     WHERE e2.ts < c.firstFraudTs AND o.f >= $min
     RETURN c.id AS card, collect({id: o.id, theta: coalesce(o.theta, 0.0), n: o.n, f: o.f}) AS buckets`,
    { bucket, cutoff, limit: limitCards, min: MIN_FRAUD_CARDS },
  );
}

export interface TerminalInfo {
  id: number;
  name: string;
  size: string;
  popularity: number;
}

export async function getAllTerminals(): Promise<TerminalInfo[]> {
  return runQuery<TerminalInfo>("MATCH (t:Terminal) RETURN t.id AS id, t.name AS name, t.size AS size, t.popularity AS popularity ORDER BY id");
}

// ───────────────────────── business value (scenario 4) ─────────────────────────

export interface ReissueData {
  bucketCards: Map<string, number[]>;
  cardFraud: Map<number, { amount: number; count: number }>;
  weeklyFraud: { week: number; amount: number; count: number }[];
}

export async function getReissueData(cutoff: number): Promise<ReissueData> {
  return withGroup("Reissue simulation inputs", async () => {
    const bc = await runQuery<{ id: string; cards: number[] }>(
      `MATCH (b:Bucket) WHERE b.f >= $min
       MATCH (c:Card)-[:EXPOSED_AT]->(b) WHERE NOT c:FraudCard OR c.firstFraudTs > $cutoff   // cards not yet blocked at the decision time
       RETURN b.id AS id, collect(c.id) AS cards`,
      { min: MIN_FRAUD_CARDS, cutoff },
    );
    const cf = await runQuery<{ card: number; amount: number; count: number }>(
      `MATCH (c:FraudCard)-[:PERFORMS]->(x:FraudTx) WHERE c.firstFraudTs > $cutoff AND x.ts > $cutoff
       RETURN c.id AS card, sum(x.amount) AS amount, count(x) AS count`,
      { cutoff },
    );
    const wf = await runQuery<{ week: number; amount: number; count: number }>(
      `MATCH (x:FraudTx)-[:IN_WEEK]->(w:Week) RETURN w.id AS week, sum(x.amount) AS amount, count(x) AS count ORDER BY week`,
    );
    return {
      bucketCards: new Map(bc.map((r) => [r.id, r.cards])),
      cardFraud: new Map(cf.map((r) => [r.card, { amount: r.amount, count: r.count }])),
      weeklyFraud: wf,
    };
  });
}

// ───────────────────────── scale benchmark (scenario 5) ─────────────────────────

export interface BenchSpec {
  edges: number;
  avgDegree: number; // buckets per fraud-card
  concurrency: number;
}

export async function benchCleanup(): Promise<void> {
  await runQuery("CALL gds.graph.drop('br_bench', false) YIELD graphName RETURN graphName");
  await runQuery("MATCH (n) WHERE n:BenchCard OR n:BenchBucket CALL (n) { DETACH DELETE n } IN TRANSACTIONS OF 50000 ROWS");
}

export async function benchGenerate(spec: BenchSpec, progress: Progress): Promise<{ cards: number; buckets: number; edges: number; genMillis: number }> {
  const t0 = performance.now();
  await benchCleanup();
  const cards = Math.round(spec.edges / spec.avgDegree);
  const buckets = Math.max(100, Math.round(spec.edges / 20)); // ~20 fraud-cards per bucket on average, skewed
  await runQuery("CREATE INDEX bench_bucket_id IF NOT EXISTS FOR (b:BenchBucket) ON (b.id)");
  await runQuery("UNWIND range(0, $b - 1) AS j CREATE (:BenchBucket {id:j, n:1.0})", { b: buckets });
  const slab = 20000;
  let edges = 0;
  for (let lo = 0; lo < cards; lo += slab) {
    progress(`Generating edges ${edges.toLocaleString()} / ~${spec.edges.toLocaleString()}`, 0.9 * (lo / cards));
    const r = await runQuery<{ e: number }>(
      `UNWIND range($lo, $hi) AS i
       CREATE (c:BenchCard {id:i, n:0.0})
       WITH c, apoc.coll.toSet([x IN range(1, $deg) | toInteger($b * rand() * rand())]) AS js   // skewed: some buckets are busy
       UNWIND js AS j
       MATCH (b:BenchBucket {id:j})
       CREATE (c)-[:BENCH_EXPOSED]->(b)
       RETURN count(*) AS e`,
      { lo, hi: Math.min(lo + slab, cards) - 1, deg: spec.avgDegree, b: buckets },
    );
    edges += Number(r[0].e);
  }
  progress("Precomputing n_j for every bucket", 0.95);
  await runQuery(
    "MATCH (b:BenchBucket) SET b.n = toFloat(count { (b)<-[:BENCH_EXPOSED]-() }) * (2.0 + 18.0 * rand()) + 1.0",
  );
  return { cards, buckets, edges, genMillis: Math.round(performance.now() - t0) };
}

export async function benchProject(): Promise<{ nodeCount: number; relationshipCount: number; projectMillis: number }> {
  await runQuery("CALL gds.graph.drop('br_bench', false) YIELD graphName RETURN graphName");
  const r = await runQuery<{ nodeCount: number; relationshipCount: number; projectMillis: number }>(
    `CALL gds.graph.project('br_bench', ['BenchCard','BenchBucket'], {BENCH_EXPOSED: {orientation:'UNDIRECTED'}}, {nodeProperties:'n'})
     YIELD nodeCount, relationshipCount, projectMillis RETURN nodeCount, relationshipCount, projectMillis`,
  );
  return r[0];
}

export async function benchRun(concurrency: number, epsilon = 1e-4, maxIterations = 200): Promise<BreachRadarSummary> {
  const r = await runQuery<BreachRadarSummary>(
    `CALL breachradar.pregel.mutate('br_bench', $cfg)
     YIELD nodeCount, causeCount, victimCount, iterations, supersteps, didConverge, finalDelta, deltas,
           preProcessingMillis, computeMillis, postProcessingMillis, nodePropertiesWritten
     RETURN nodeCount, causeCount, victimCount, iterations, supersteps, didConverge, finalDelta, deltas,
            preProcessingMillis, computeMillis, postProcessingMillis, nodePropertiesWritten`,
    { cfg: { ...DEFAULT_ALGO, concurrency, epsilon, maxIterations, populationProperty: "n", mutateProperty: "theta", user: "neo4j" } },
  );
  return r[0];
}

export async function benchTop(k = 5): Promise<{ id: number; theta: number }[]> {
  return runQuery(
    `CALL gds.graph.nodeProperty.stream('br_bench', 'theta', ['BenchBucket']) YIELD nodeId, propertyValue
     RETURN gds.util.asNode(nodeId).id AS id, propertyValue AS theta ORDER BY theta DESC LIMIT $k`,
    { k },
  );
}

export { bucketId };
