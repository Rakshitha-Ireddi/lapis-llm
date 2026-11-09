import { describe, expect, it } from "vitest";
import cases from "../../shared/sizing-cases.json";
import {
  breakdown,
  estimateMemoryGib,
  isQuant,
  kvCacheGib,
  suggestQuant,
  verdict,
  weightsGib,
  type Quant,
} from "../src/lib/sizing";

describe("sizing matches the Python implementation (shared fixture)", () => {
  it.each(cases.estimates)("estimate $params_b B $quant ctx $context", (c) => {
    expect(estimateMemoryGib(c.params_b, c.quant as Quant, c.context)).toBeCloseTo(c.expected_gib, 2);
  });

  it.each(cases.verdicts)("verdict $needed_gib on $memory_gib", (c) => {
    expect(verdict(c.needed_gib, c.memory_gib)).toBe(c.verdict);
  });

  it.each(cases.suggestions)("suggestion $params_b B on $memory_gib GiB", (c) => {
    expect(suggestQuant(c.params_b, c.context, c.memory_gib)).toBe(c.quant);
  });
});

describe("sizing", () => {
  it("breakdown parts add up to the total", () => {
    const b = breakdown(8, "q4", 8192);
    expect(b.weights + b.kvCache + b.overhead).toBeCloseTo(b.total, 1);
  });

  it("grows with precision and context", () => {
    expect(weightsGib(8, "q8")).toBeGreaterThan(weightsGib(8, "q4"));
    expect(kvCacheGib(8, 32768)).toBeCloseTo(kvCacheGib(8, 8192) * 4);
  });

  it("rejects bad input", () => {
    expect(() => weightsGib(0)).toThrow();
    expect(() => kvCacheGib(8, 0)).toThrow();
    expect(isQuant("q3")).toBe(false);
    expect(isQuant("q4")).toBe(true);
  });
});
