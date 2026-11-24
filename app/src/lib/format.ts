export const fmt = (n: number, d = 0) => n.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });
export const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;
export const usd = (x: number) => `$${Math.round(x).toLocaleString("en-US")}`;
export const ms = (x: number) => (x >= 10000 ? `${(x / 1000).toFixed(1)} s` : x >= 1000 ? `${(x / 1000).toFixed(2)} s` : `${Math.round(x)} ms`);

/** "T012-W03" -> terminal id 12, week 3 */
export function parseBucket(id: string): { terminal: number; week: number } {
  const m = /^T(\d+)-W(\d+)$/.exec(id);
  return m ? { terminal: Number(m[1]), week: Number(m[2]) } : { terminal: -1, week: -1 };
}
