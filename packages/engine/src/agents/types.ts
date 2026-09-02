import type { State } from "../types.js";

/** Interface that all agents implement */
export interface Agent {
  /** Select an action given the current state */
  selectAction(state: State): number;
  /**
   * Update the agent with the reward received.
   *
   * Each agent uses the state arguments according to its own math:
   *   - MAB:      ignores both states.
   *   - LinUCB:   uses `prevState` as the decision-time context x (A += xxᵀ, b += rx).
   *               Ignores `nextState`.
   *   - Q-Learning: uses `nextState` for the γ·maxQ[s′] bootstrap; `prevState` is the
   *               state that was given to the preceding selectAction (already recorded
   *               in lastStateKey — this param documents intent, is not re-read).
   *               Bootstrap is suppressed when `done` is true.
   *
   * @param prevState decision-time context — state passed to the selectAction that chose `action`.
   * @param nextState state s′ observed after the step/shift ends.
   * @param done true on the terminal shift — suppresses Q-Learning's bootstrap.
   */
  update(action: number, reward: number, prevState: State, nextState: State, done?: boolean): void;
  /** Get current exploration rate (if applicable) */
  getEpsilon?(): number;
  /** Get the per-episode epsilon decay multiplier */
  getEpsilonDecay?(): number;
  /** Decay epsilon once per episode (not per update) */
  decayEpsilon?(): void;
  /** Advance episode counter (e.g. for LinUCB round-robin) */
  advanceEpisode?(): void;
  /** Get internal state size (e.g. Q-table entries) */
  getStateSize?(): number;
}
