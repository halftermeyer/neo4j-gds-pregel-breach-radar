// Headless end-to-end check of the same code the UI runs:  npm run e2e   (needs the demo database + plugin up)
import { generateDataset, DEFAULT_GEN, pocBuckets } from "../src/lib/gen.ts";
import * as db from "../src/lib/db.ts";
import { runPipeline, invalidateCache } from "../src/lib/pipeline.ts";
import { rankCount, rankRatio, rankPrior, rankGreedy, rankTheta, atK } from "../src/lib/eval.ts";

const t0 = Date.now();
console.log("env", JSON.stringify(await db.getEnvStatus()));
await db.resetDemo(); invalidateCache();
const ds = generateDataset(DEFAULT_GEN);
await db.ingestDataset(ds, ds.pocs, (m, f) => process.stdout.write(`\r${(f * 100).toFixed(0).padStart(3)}% ${m.padEnd(70)}`));
console.log("\nmeta", JSON.stringify(await db.getMeta()), `${Date.now() - t0}ms`);
for (const [p, noise] of [[0.5, 0], [0.2, 100], [0.1, 100]] as const) {
  const r = await runPipeline({ p, noise, cutoffWeek: 12, seed: 1, snapshots: true });
  const K = r.truth.size;
  console.log(`\np=${p} noise=${noise}: iters=${r.summary.iterations} converged=${r.summary.didConverge} computeMs=${r.summary.computeMillis} kept=${r.keptBuckets} edges=${r.edges.length} total=${r.totalMs}ms`);
  console.log("  steps:", r.steps.map((s) => `${s.label}=${s.ms}`).join(" | "));
  const kept = r.buckets.map((b) => b.id);
  const R = { count: rankCount(r.buckets), ratio: rankRatio(r.buckets), prior: rankPrior(r.buckets), greedy: rankGreedy(kept, r.edges), breachradar: rankTheta(r.buckets) };
  for (const [k, rk] of Object.entries(R)) console.log("  ", k.padEnd(12), `P@${K}=${atK(rk, r.truth, K).precision.toFixed(2)} R@2K=${atK(rk, r.truth, 2 * K).recall.toFixed(2)}`);
}
void pocBuckets;
process.exit(0);
