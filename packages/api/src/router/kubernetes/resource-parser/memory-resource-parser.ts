import type { ResourceParser } from "./resource-parser";

export class MemoryResourceParser implements ResourceParser {
  private readonly binaryMultipliers: Record<string, number> = {
    ki: 1024,
    mi: 1024 ** 2,
    gi: 1024 ** 3,
    ti: 1024 ** 4,
    pi: 1024 ** 5,
  } as const;

  private readonly decimalMultipliers: Record<string, number> = {
    k: 1000,
    m: 1000 ** 2,
    g: 1000 ** 3,
    t: 1000 ** 4,
    p: 1000 ** 5,
  } as const;

  parse(value: string): number {
    if (!value.length) {
      return NaN;
    }

    value = value.replace(/,/g, "").trim();

    const [, numericValue, unit = ""] = /^([0-9.]+)\s*([a-zA-Z]*)$/.exec(value) || [];

    if (numericValue === undefined) {
      return NaN;
    }

    const parsedValue = parseFloat(numericValue);

    if (isNaN(parsedValue)) {
      return NaN;
    }

    const unitLower = unit.toLowerCase();

    // Handle binary units (Ki, Mi, Gi, etc.)
    if (this.binaryMultipliers[unitLower]) {
      return (parsedValue * this.binaryMultipliers[unitLower]) / this.binaryMultipliers.gi!;
    }

    // Handle decimal units (K, M, G, etc.)
    if (this.decimalMultipliers[unitLower]) {
      return (parsedValue * this.decimalMultipliers[unitLower]) / this.binaryMultipliers.gi!;
    }

    // No unit or unrecognized unit, assume bytes and convert to GiB
    return parsedValue / this.binaryMultipliers.gi!;
  }
}
