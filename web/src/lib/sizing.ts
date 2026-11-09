/**
 * Memory sizing rules of thumb. Mirrors server/src/lapis/sizing.py exactly;
 * both are tested against shared/sizing-cases.json.
 */

export const QUANT_BITS = {
  q4: 4.5,
  q5: 5.5,
  q6: 6.5,
  q8: 8.5,
  fp16: 16,
} as const;

export type Quant = keyof typeof QUANT_BITS;
export type Verdict = "comfortable" | "tight" | "too-big";

export const OVERHEAD_GIB = 0.6;
export const KV_MIB_PER_TOKEN_8B = 0.125;

const round2 = (value: number): number => Math.floor(value * 100 + 0.5) / 100;

export function isQuant(value: string): value is Quant {
  return value in QUANT_BITS;
}

export function weightsGib(paramsB: number, quant: Quant = "q4"): number {
  if (!isQuant(quant)) throw new Error(`unknown quantisation ${quant}`);
  if (paramsB <= 0) throw new Error("paramsB must be positive");
  return (paramsB * 1e9 * QUANT_BITS[quant]) / 8 / 2 ** 30;
}

export function kvCacheGib(paramsB: number, context: number): number {
  if (context <= 0) throw new Error("context must be positive");
  const perTokenMib = KV_MIB_PER_TOKEN_8B * (paramsB / 8) ** 0.4;
  return (context * perTokenMib) / 1024;
}

export interface Breakdown {
  weights: number;
  kvCache: number;
  overhead: number;
  total: number;
}

export function breakdown(paramsB: number, quant: Quant = "q4", context = 8192): Breakdown {
  const weights = weightsGib(paramsB, quant);
  const kvCache = kvCacheGib(paramsB, context);
  return {
    weights: round2(weights),
    kvCache: round2(kvCache),
    overhead: OVERHEAD_GIB,
    total: round2(weights + kvCache + OVERHEAD_GIB),
  };
}

export function estimateMemoryGib(paramsB: number, quant: Quant = "q4", context = 8192): number {
  return breakdown(paramsB, quant, context).total;
}

export function verdict(neededGib: number, memoryGib: number): Verdict {
  if (memoryGib <= 0) return "too-big";
  const ratio = neededGib / memoryGib;
  if (ratio <= 0.85) return "comfortable";
  if (ratio <= 0.95) return "tight";
  return "too-big";
}

export function suggestQuant(paramsB: number, context: number, memoryGib: number): Quant | null {
  for (const quant of ["fp16", "q8", "q6", "q5", "q4"] as const) {
    if (verdict(estimateMemoryGib(paramsB, quant, context), memoryGib) === "comfortable") {
      return quant;
    }
  }
  return null;
}
