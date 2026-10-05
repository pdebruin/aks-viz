import { CpuMem, ResourceMap } from './types';

const BINARY_SUFFIXES: Record<string, number> = {
  Ki: 2 ** 10,
  Mi: 2 ** 20,
  Gi: 2 ** 30,
  Ti: 2 ** 40,
  Pi: 2 ** 50,
  Ei: 2 ** 60,
};

const DECIMAL_SUFFIXES: Record<string, number> = {
  n: 1e-9,
  u: 1e-6,
  m: 1e-3,
  '': 1,
  k: 1e3,
  M: 1e6,
  G: 1e9,
  T: 1e12,
  P: 1e15,
  E: 1e18,
};

const QUANTITY_RE = /^([+-]?(?:\d+\.?\d*|\.\d+))(.*)$/;

/**
 * Parses a Kubernetes resource.Quantity string into a plain number in base units
 * (cores for cpu, bytes for memory). Returns null for anything that does not parse.
 * Supports binary suffixes (Ki..Ei), decimal suffixes (n, u, m, k, M..E) and decimal exponents (1e3, 1E3).
 */
export function parseQuantity(input: string | number | undefined | null): number | null {
  if (input === undefined || input === null) return null;
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  const s = input.trim();
  const match = QUANTITY_RE.exec(s);
  if (!match) return null;
  const num = Number(match[1]);
  const suffix = match[2];
  if (!Number.isFinite(num)) return null;
  if (suffix in BINARY_SUFFIXES) return num * BINARY_SUFFIXES[suffix];
  if (suffix in DECIMAL_SUFFIXES) return num * DECIMAL_SUFFIXES[suffix];
  const exp = /^[eE]([+-]?\d+)$/.exec(suffix);
  if (exp) return num * 10 ** Number(exp[1]);
  return null;
}

export function cpuToMillicores(q: string | undefined): number {
  const v = parseQuantity(q);
  return v === null ? 0 : Math.round(v * 1000 * 1000) / 1000;
}

export function memoryToBytes(q: string | undefined): number {
  const v = parseQuantity(q);
  return v === null ? 0 : Math.round(v);
}

export function cpuMemFromResources(r: ResourceMap | undefined): CpuMem {
  return { cpuMillicores: cpuToMillicores(r?.cpu), memoryBytes: memoryToBytes(r?.memory) };
}

export const ZERO: CpuMem = Object.freeze({ cpuMillicores: 0, memoryBytes: 0 });

export function addCpuMem(a: CpuMem, b: CpuMem): CpuMem {
  return {
    cpuMillicores: a.cpuMillicores + b.cpuMillicores,
    memoryBytes: a.memoryBytes + b.memoryBytes,
  };
}

export function subCpuMem(a: CpuMem, b: CpuMem): CpuMem {
  return {
    cpuMillicores: a.cpuMillicores - b.cpuMillicores,
    memoryBytes: a.memoryBytes - b.memoryBytes,
  };
}

export function maxCpuMem(a: CpuMem, b: CpuMem): CpuMem {
  return {
    cpuMillicores: Math.max(a.cpuMillicores, b.cpuMillicores),
    memoryBytes: Math.max(a.memoryBytes, b.memoryBytes),
  };
}
