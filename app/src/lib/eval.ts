// Baselines and scoring. Pure functions over bucket statistics returned by Cypher.
// Baselines: fraud-card count, fraud-card ratio, ratio with prior, greedy vertex cover.
// BreachRadar itself is NOT here: it runs as a GDS Pregel procedure in the database.

export const ALPHA = 0.2;
export const BETA = 15;
export const MIN_FRAUD_CARDS = 5;

export interface BucketStat {
  id: string;
  n: number; // cards on the bucket (fraud or not)
  f: number; // fraud-cards on the bucket (before their first fraud)
  poc: boolean; // ground truth
  theta?: number;
}

export interface Ranked {
  id: string;
  score: number;
}

export type MethodKey = "count" | "ratio" | "prior" | "greedy" | "breachradar";

export const METHODS: { key: MethodKey; label: string; color: string }[] = [
  { key: "count", label: "Fraud-card count", color: "#94a3b8" },
  { key: "ratio", label: "Fraud-card ratio", color: "#f59e0b" },
  { key: "prior", label: "Ratio with prior", color: "#a855f7" },
  { key: "greedy", label: "Greedy vertex cover", color: "#0ea5e9" },
  { key: "breachradar", label: "BreachRadar (Pregel)", color: "#e11d48" },
];

const sortDesc = (rows: Ranked[]) => rows.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));

export const rankCount = (bs: BucketStat[]): Ranked[] => sortDesc(bs.map((b) => ({ id: b.id, score: b.f })));
export const rankRatio = (bs: BucketStat[]): Ranked[] => sortDesc(bs.map((b) => ({ id: b.id, score: b.f / b.n })));
export const rankPrior = (bs: BucketStat[]): Ranked[] => sortDesc(bs.map((b) => ({ id: b.id, score: (b.f + ALPHA) / (b.n + ALPHA + BETA) })));
export const rankTheta = (bs: BucketStat[]): Ranked[] => sortDesc(bs.map((b) => ({ id: b.id, score: b.theta ?? 0 })));

/** Greedy vertex cover: repeatedly pick the bucket covering the most still-uncovered fraud cards, remove those cards.
 *  Score = number of newly covered cards at pick time (so the ranking is the pick order). */
export function rankGreedy(buckets: string[], edges: [number, string][]): Ranked[] {
  const cardsOf = new Map<string, Set<number>>();
  const bucketsOf = new Map<number, string[]>();
  for (const b of buckets) cardsOf.set(b, new Set());
  for (const [c, b] of edges) {
    cardsOf.get(b)?.add(c);
    const l = bucketsOf.get(c);
    if (l) l.push(b);
    else bucketsOf.set(c, [b]);
  }
  const remaining = new Map<string, number>();
  for (const [b, s] of cardsOf) remaining.set(b, s.size);
  const out: Ranked[] = [];
  while (remaining.size > 0) {
    let best = "";
    let bestN = -1;
    for (const [b, k] of remaining) if (k > bestN || (k === bestN && b < best)) { best = b; bestN = k; }
    out.push({ id: best, score: bestN });
    remaining.delete(best);
    if (bestN <= 0) continue;
    for (const c of [...(cardsOf.get(best) ?? [])]) {
      for (const b of bucketsOf.get(c) ?? []) {
        if (b === best) continue;
        const s = cardsOf.get(b);
        if (s?.delete(c)) remaining.set(b, (remaining.get(b) ?? 1) - 1);
      }
    }
  }
  return out;
}

export interface AtK {
  k: number;
  hits: number;
  precision: number;
  recall: number;
}

export function atK(ranking: Ranked[], truth: Set<string>, k: number): AtK {
  let hits = 0;
  for (let i = 0; i < Math.min(k, ranking.length); i++) if (truth.has(ranking[i].id)) hits++;
  return { k, hits, precision: k > 0 ? hits / k : 0, recall: truth.size > 0 ? hits / truth.size : 0 };
}

/** Precision/recall points for every cut-off K = 1..max. Recall is against ALL true POC buckets (even undetectable ones). */
export function prCurve(ranking: Ranked[], truth: Set<string>, max = ranking.length): { k: number; precision: number; recall: number }[] {
  const pts: { k: number; precision: number; recall: number }[] = [];
  let hits = 0;
  for (let i = 0; i < Math.min(max, ranking.length); i++) {
    if (truth.has(ranking[i].id)) hits++;
    pts.push({ k: i + 1, precision: hits / (i + 1), recall: truth.size ? hits / truth.size : 0 });
  }
  return pts;
}

export function averagePrecision(ranking: Ranked[], truth: Set<string>): number {
  let hits = 0;
  let s = 0;
  ranking.forEach((r, i) => {
    if (truth.has(r.id)) {
      hits++;
      s += hits / (i + 1);
    }
  });
  return truth.size ? s / truth.size : 0;
}
