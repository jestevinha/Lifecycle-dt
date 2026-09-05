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
