/** Parse "HH:MM" clock string into minute-of-day */
export function clockToMinutes(clock: string): number {
  const [h, m] = clock.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Deterministic PRNG factory (mulberry32). Given the same seed, produces the
 * same sequence of floats in [0,1) on every call — used to make agent-side
 * exploration (MAB ε-greedy, Q-Learning ε-greedy) reproducible from
 * `simSeed`/`episodeSeed`, the same way the Java simulator already is via
 * `Weather.setSeed(seed)`. See Known-Bugs-Fixed #12.
 *
 * Falls back to `Math.random` when no seed is supplied (undefined/null/NaN),
 * preserving prior unseeded behavior for any caller that doesn't opt in.
 */
export function createRng(seed?: number | null): () => number {
  if (seed === undefined || seed === null || Number.isNaN(seed)) {
    return Math.random;
  }
  let state = seed >>> 0;
  return function mulberry32(): number {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Index of the maximum value in `values`, breaking ties uniformly at random
 * via `rng` (Known-Bugs-Fixed #17, fixed 2026-09-12). `Array.indexOf` always
 * returns the FIRST index achieving the max, so a naive `values.indexOf(Math.max(...values))`
 * silently favors the lowest-id action whenever several are tied — most
 * commonly several actions still sitting at their zero-initialized default in
 * an under-sampled state. Pass the agent's own seeded `rng` (not `Math.random`)
 * so the tie-break stays reproducible from `simSeed`, consistent with
 * Known-Bugs-Fixed #12.
 */
export function argmaxTieBreak(values: number[], rng: () => number): number {
  let bestIndices: number[] = [0];
  let bestValue = values[0];
  for (let i = 1; i < values.length; i++) {
    if (values[i] > bestValue) {
      bestValue = values[i];
      bestIndices = [i];
    } else if (values[i] === bestValue) {
      bestIndices.push(i);
    }
  }
  return bestIndices.length === 1
    ? bestIndices[0]
    : bestIndices[Math.floor(rng() * bestIndices.length)];
}
