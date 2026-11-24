// Headless scale benchmark (same functions as scenario 5):  npm run bench -- 5000000
import * as db from "../src/lib/db.ts";
const edges = Number(process.argv[2] ?? 1_000_000);
const conc = Number(process.argv[3] ?? 4);
const g = await db.benchGenerate({ edges, avgDegree: 4, concurrency: conc }, () => {});
console.log(`generated ${g.edges} edges, ${g.cards} cards, ${g.buckets} buckets in ${g.genMillis} ms`);
const p = await db.benchProject();
console.log(`projected ${p.nodeCount} nodes / ${p.relationshipCount} rels in ${p.projectMillis} ms`);
const s = await db.benchRun(conc, 1e-4, 200);
console.log(`pregel: iterations=${s.iterations} supersteps=${s.supersteps} converged=${s.didConverge} pre=${s.preProcessingMillis} compute=${s.computeMillis} post=${s.postProcessingMillis}`);
await db.benchCleanup();
process.exit(0);
