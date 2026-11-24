// Synthetic card-transaction generator with injected Points of Compromise (POC).
// All data is synthetic. Pure functions (no DOM, no Neo4j) so they can run in the browser and in tools/.
//
// Model
//   - terminals have a popularity (log-normal): a few big busy merchants, a long tail of small ones
//   - each card has a few favourite terminals it keeps going back to, and otherwise follows popularity
//   - a POC is a (terminal, week window): "breach" = a big terminal over 3 consecutive weeks (data breach),
//     "skimmer" = a medium terminal over 1 week (a skimmer device installed then removed)
//   - a card that transacts at a POC bucket is compromised with probability p (the stealing probability)
//   - compromised cards are used fraudulently 1..3 weeks later at random terminals (cash-out)
//   - noise cards are marked as fraud without any POC (e.g. unrelated fraud), as a % of the compromised cards
// Ground truth (which buckets are POCs, which cards were really compromised) is always known for scoring.
import { mulberry32, normal, poisson, weightedSampler, shuffle, type Rand } from "./rng.ts";

export const MIN_PER_WEEK = 7 * 24 * 60;

export interface GenParams {
  cards: number;
  terminals: number;
  weeks: number;
  txPerCardWeek: number;
  breachPocs: number;
  skimmerPocs: number;
  favouriteShare: number; // share of a card's transactions at its favourite terminals
  seed: number;
}

export const DEFAULT_GEN: GenParams = {
  cards: 5000,
  terminals: 160,
  weeks: 12,
  txPerCardWeek: 1.1,
  breachPocs: 5,
  skimmerPocs: 5,
  favouriteShare: 0.5,
  seed: 42,
};

export type TerminalSize = "large" | "medium" | "small";

export interface Terminal {
  id: number;
  name: string;
  size: TerminalSize;
  popularity: number;
}

export interface LegitTx {
  id: number;
  card: number;
  terminal: number;
  week: number;
  ts: number; // minutes since week 0
  amount: number;
}

export interface Poc {
  id: string;
  type: "breach" | "skimmer";
  terminal: number;
  weekStart: number;
  weekEnd: number; // inclusive
}

export interface Dataset {
  params: GenParams;
  terminals: Terminal[];
  txs: LegitTx[];
  pocs: Poc[];
}

export const bucketId = (terminal: number, week: number) => `T${String(terminal).padStart(3, "0")}-W${String(week).padStart(2, "0")}`;

const CATEGORIES = ["Fuel", "Grocery", "Pharmacy", "Electronics", "Diner", "Cafe", "Department Store", "Hardware", "Bookshop", "Cinema", "Garage", "Bakery"];
const TOWNS = ["Aldermoor", "Brightwater", "Castlegate", "Dunmere", "Elmford", "Foxhollow", "Glenrock", "Harlowe", "Ironbridge", "Juniper Bay", "Kingsmead", "Larkfield", "Marlow", "Northcote", "Oakhurst", "Pinecrest"];

export function generateDataset(params: GenParams = DEFAULT_GEN): Dataset {
  const r: Rand = mulberry32(params.seed);
  const { cards, terminals: T, weeks: W } = params;

  // terminals: log-normal popularity, size class by popularity rank
  const pops = Array.from({ length: T }, () => Math.exp(0.95 * normal(r)));
  const order = pops.map((p, i) => [p, i] as const).sort((a, b) => b[0] - a[0]);
  const sizeOf: TerminalSize[] = new Array(T);
  order.forEach(([, i], rank) => {
    sizeOf[i] = rank < T * 0.18 ? "large" : rank < T * 0.6 ? "medium" : "small";
  });
  const terminals: Terminal[] = pops.map((p, i) => ({
    id: i,
    name: `${CATEGORIES[Math.floor(r() * CATEGORIES.length)]} ${TOWNS[Math.floor(r() * TOWNS.length)]} #${i}`,
    size: sizeOf[i],
    popularity: p,
  }));
  const pickTerminal = weightedSampler(pops);

  // cards: favourites + popularity-weighted wandering
  const favs: number[][] = Array.from({ length: cards }, () => [pickTerminal(r), pickTerminal(r), pickTerminal(r)]);
  const txs: LegitTx[] = [];
  let txId = 0;
  for (let c = 0; c < cards; c++) {
    for (let w = 0; w < W; w++) {
      const k = poisson(r, params.txPerCardWeek);
      for (let j = 0; j < k; j++) {
        const t = r() < params.favouriteShare ? favs[c][Math.floor(r() * favs[c].length)] : pickTerminal(r);
        txs.push({
          id: txId++,
          card: c,
          terminal: t,
          week: w,
          ts: w * MIN_PER_WEEK + Math.floor(r() * MIN_PER_WEEK),
          amount: Math.round(Math.exp(3.7 + 0.8 * normal(r)) * 100) / 100,
        });
      }
    }
  }

  // POCs: breaches on large terminals (3 weeks), skimmers on medium terminals (1 week); distinct terminals
  const large = shuffle(terminals.filter((t) => t.size === "large"), r);
  const medium = shuffle(terminals.filter((t) => t.size === "medium"), r);
  const latestStart = Math.max(1, W - 6); // leave room for the cash-out to be observed
  const pocs: Poc[] = [];
  for (let i = 0; i < params.breachPocs && i < large.length; i++) {
    const s = 1 + Math.floor(r() * (latestStart - 2));
    pocs.push({ id: `breach-${i + 1}`, type: "breach", terminal: large[i].id, weekStart: s, weekEnd: s + 2 });
  }
  for (let i = 0; i < params.skimmerPocs && i < medium.length; i++) {
    const s = 1 + Math.floor(r() * latestStart);
    pocs.push({ id: `skimmer-${i + 1}`, type: "skimmer", terminal: medium[i].id, weekStart: s, weekEnd: s });
  }
  return { params, terminals, txs, pocs };
}

export function pocBuckets(pocs: Poc[]): string[] {
  const out: string[] = [];
  for (const p of pocs) for (let w = p.weekStart; w <= p.weekEnd; w++) out.push(bucketId(p.terminal, w));
  return out;
}

// ───────────────────────── fraud labelling (re-runnable for the sliders) ─────────────────────────

export interface LabelParams {
  p: number; // stealing probability 0..1
  noisePct: number; // noise cards as % of compromised fraud cards (0..100)
  seed: number;
}

export interface Exposure {
  card: number;
  bucket: string; // POC bucket id
  ts: number;
}

export interface FraudTx {
  id: number;
  card: number;
  terminal: number;
  week: number;
  ts: number;
  amount: number;
  source: "poc" | "noise";
}

export interface Labels {
  fraudTx: FraudTx[];
  compromisedCards: number;
  noiseCards: number;
}

/** Sample which exposed cards are compromised and when they are used fraudulently. Common random numbers per
 *  (card, bucket) make results monotone in p for a fixed seed. */
export function sampleLabels(
  exposures: Exposure[],
  nCards: number,
  nTerminals: number,
  weeks: number,
  lp: LabelParams,
  firstIdOffset = 1_000_000,
): Labels {
  const horizon = weeks * MIN_PER_WEEK;
  const compromisedAt = new Map<number, number>();
  for (const e of exposures) {
    // deterministic uniform per (card, bucket)
    const h = mulberry32((lp.seed * 7919 + e.card * 104729 + hashStr(e.bucket)) >>> 0)();
    if (h < lp.p) {
      const prev = compromisedAt.get(e.card);
      if (prev === undefined || e.ts < prev) compromisedAt.set(e.card, e.ts);
    }
  }
  const fraudTx: FraudTx[] = [];
  let id = firstIdOffset;
  let compromised = 0;
  for (const [card, ts0] of [...compromisedAt.entries()].sort((a, b) => a[0] - b[0])) {
    const r = mulberry32((lp.seed * 31 + card * 2654435761) >>> 0);
    const ts = ts0 + Math.floor((1 + r() * 2) * MIN_PER_WEEK); // cash-out 1..3 weeks after exposure
    if (ts >= horizon) continue; // not observed within the data window
    compromised++;
    const k = 1 + (r() < 0.5 ? 1 : 0) + (r() < 0.2 ? 1 : 0);
    for (let j = 0; j < k; j++) {
      const t = ts + Math.floor(r() * 3 * 24 * 60);
      if (t >= horizon) continue;
      fraudTx.push({ id: id++, card, terminal: Math.floor(r() * nTerminals), week: Math.floor(t / MIN_PER_WEEK), ts: t, amount: Math.round(Math.exp(5.1 + 0.6 * normal(r)) * 100) / 100, source: "poc" });
    }
  }
  // noise: fraud-marked cards with no POC behind them
  const nNoise = Math.round((lp.noisePct / 100) * compromised);
  const rn = mulberry32((lp.seed * 977 + 13) >>> 0);
  const pool = shuffle(Array.from({ length: nCards }, (_, i) => i).filter((c) => !compromisedAt.has(c)), rn);
  let noise = 0;
  for (const card of pool.slice(0, nNoise)) {
    const t = Math.floor((0.25 + 0.75 * rn()) * horizon);
    fraudTx.push({ id: id++, card, terminal: Math.floor(rn() * nTerminals), week: Math.floor(t / MIN_PER_WEEK), ts: t, amount: Math.round(Math.exp(5.1 + 0.6 * normal(rn)) * 100) / 100, source: "noise" });
    noise++;
  }
  return { fraudTx, compromisedCards: compromised, noiseCards: noise };
}

export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
