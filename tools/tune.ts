// Dev-only: generate a dataset in memory, run all methods (with a TS copy of BreachRadar) to tune generator realism.
//   node tools/tune.ts [p] [noise]
import { generateDataset, sampleLabels, pocBuckets, bucketId, DEFAULT_GEN, MIN_PER_WEEK, type Exposure } from "../app/src/lib/gen.ts";
import { rankCount, rankRatio, rankPrior, rankGreedy, atK, averagePrecision, ALPHA, BETA, type Ranked } from "../app/src/lib/eval.ts";

const p = Number(process.argv[2] ?? 0.5), noise = Number(process.argv[3] ?? 0);
const t0 = Date.now();
const G = { ...DEFAULT_GEN, ...JSON.parse(process.env.G ?? '{}') }; const ds = generateDataset(G);
const truthList = pocBuckets(ds.pocs); const truth = new Set(truthList);
// exposures per card-bucket (unique, min ts)
const exp = new Map<string, { card: number; bucket: string; ts: number }>();
for (const t of ds.txs) { const k = `${t.card}|${t.terminal}|${t.week}`; const e = exp.get(k); if (!e || t.ts < e.ts) exp.set(k, { card: t.card, bucket: bucketId(t.terminal, t.week), ts: t.ts }); }
const n = new Map<string, number>(); for (const e of exp.values()) n.set(e.bucket, (n.get(e.bucket) ?? 0) + 1);
const pocExp: Exposure[] = [...exp.values()].filter((e) => truth.has(e.bucket));
const lab = sampleLabels(pocExp, DEFAULT_GEN.cards, DEFAULT_GEN.terminals, DEFAULT_GEN.weeks, { p, noisePct: noise, seed: 1 });
const firstFraud = new Map<number, number>(); for (const f of lab.fraudTx) firstFraud.set(f.card, Math.min(firstFraud.get(f.card) ?? Infinity, f.ts));
const edges: [number, string][] = []; const fcount = new Map<string, number>();
for (const e of exp.values()) { const ff = firstFraud.get(e.card); if (ff !== undefined && e.ts < ff) { edges.push([e.card, e.bucket]); fcount.set(e.bucket, (fcount.get(e.bucket) ?? 0) + 1); } }
const kept = new Set([...fcount].filter(([, f]) => f >= 5).map(([b]) => b));
const kedges = edges.filter(([, b]) => kept.has(b));
const stats = [...kept].map((id) => ({ id, n: n.get(id)!, f: fcount.get(id)!, poc: truth.has(id) }));
// BreachRadar TS copy
const cardB = new Map<number, string[]>(); for (const [c, b] of kedges) (cardB.get(c) ?? cardB.set(c, []).get(c)!).push(b);
const nb = new Map(stats.map((s) => [s.id, s.n]));
let z = new Map<string, number>(); for (const bs of cardB.values()) for (const b of bs) z.set(b, (z.get(b) ?? 0) + 1 / bs.length);
let th = new Map<string, number>(); for (const [b, nn] of nb) th.set(b, ((z.get(b) ?? 0) + ALPHA) / (nn + ALPHA + BETA));
let it = 0;
for (; it < 200; it++) { const nz = new Map<string, number>(); for (const bs of cardB.values()) { let S = 0; for (const b of bs) S += th.get(b)!; for (const b of bs) nz.set(b, (nz.get(b) ?? 0) + th.get(b)! / S); }
  let d = 0; const nt = new Map<string, number>(); for (const [b, nn] of nb) { const v = ((nz.get(b) ?? 0) + ALPHA) / (nn + ALPHA + BETA); d += Math.abs(v - th.get(b)!); nt.set(b, v); } th = nt; if (d < 1e-6) break; }
const rank = (m: Map<string, number>): Ranked[] => [...m].map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score);
const R: Record<string, Ranked[]> = { count: rankCount(stats), ratio: rankRatio(stats), prior: rankPrior(stats), greedy: rankGreedy([...kept], kedges), breachradar: rank(th) };
console.log(`tx=${ds.txs.length} buckets=${n.size} truth=${truth.size} fraudCards=${firstFraud.size} (comp=${lab.compromisedCards}, noise=${lab.noiseCards}) kept=${kept.size} truthKept=${[...truth].filter((b) => kept.has(b)).length} iters=${it} ${Date.now() - t0}ms`);
const K = truth.size;
for (const [k, r] of Object.entries(R)) { const a = atK(r, truth, K), b = atK(r, truth, 2 * K); console.log(k.padEnd(12), `P@${K}=${a.precision.toFixed(2)} R@2K=${b.recall.toFixed(2)} AP=${averagePrecision(r, truth).toFixed(2)}  top5=${r.slice(0, 5).map((x) => (truth.has(x.id) ? "✓" : "✗")).join("")}`); }
void MIN_PER_WEEK;
console.log("pocExp", pocExp.length, "pocs", JSON.stringify(ds.pocs.slice(0,2)));
console.log("p", p, "noise", noise, typeof p, pocExp[0]);
console.log("lab", lab.compromisedCards, lab.fraudTx.length, "cards", DEFAULT_GEN.cards, DEFAULT_GEN.terminals, DEFAULT_GEN.weeks);
