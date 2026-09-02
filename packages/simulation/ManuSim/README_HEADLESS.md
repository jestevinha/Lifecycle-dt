### ManuSim Headless Simulation Core

This README documents the headless CLI entry point and configuration for running ManuSim without any GUI and producing machine‑readable traces.

#### Run examples
```
java com.inknow.manusim.control.HeadlessMain                          # defaults
java com.inknow.manusim.control.HeadlessMain --steps 5000             # 5000 steps
java com.inknow.manusim.control.HeadlessMain --seed 42 --runs 3       # 3 runs, seeds 42,43,44
java com.inknow.manusim.control.HeadlessMain --seeds 1,10,99          # explicit seed list (highest precedence)
java com.inknow.manusim.control.HeadlessMain --seedRange 100:105      # 6 runs, seeds 100..105 (2nd precedence)
java com.inknow.manusim.control.HeadlessMain --emitEvents true        # also write events.jsonl
java com.inknow.manusim.control.HeadlessMain --outputDir out          # choose output directory
java com.inknow.manusim.control.HeadlessMain --config data/scenario.json  # load config JSON (CLI overrides config)
```

Outputs are written under a per‑experiment folder with an ISO‑like timestamp:
- Base folder: `outputDir/<YYYY-MM-DD'T'HH-mm-ss>/`
- KPI JSONL per run: `sim_<timestamp>_r<run>_s<seed>.jsonl`
- When `emitEvents=true`, an event stream per run: `sim_<timestamp>_r<run>_s<seed>_events.jsonl`

#### CLI options
- `--steps <N>`: number of simulation steps (default 1000)
- `--seed <S>`: base RNG seed for single run or start of sequence
- `--runs <N>`: number of runs (default 1). With `--seed`, generates seeds `seed, seed+1, ...`.
- `--seeds <a,b,c>`: explicit list of seeds (highest precedence; overrides `--seedRange`, `--seed` and `--runs`)
- `--seedRange <start:end>`: inclusive range of seeds (2nd precedence; overrides `--seed` and `--runs`)
- `--emitEvents <true|false>`: enable events.jsonl output (default false)
- `--outputDir <dir>`: where to write outputs (default `out`)
- `--config <path>`: load JSON config with the fields below. CLI overrides config.

#### Config JSON
CLI values override config values. For seeding, only one of the following should be provided at a time (others will be ignored with a warning) — precedence: `seeds[]` > `seedRangeStart/seedRangeEnd` > `seed + runs`.

Example (single mechanism only):
```
{
  "steps": 2000,
  "seed": 12345,
  "runs": 2,
  "emitEvents": true,
  "outputDir": "out/exp1"
}
```

Alternatively (explicit list):
```
{
  "steps": 2000,
  "seeds": [12345, 12346, 12347],
  "emitEvents": true,
  "outputDir": "out/exp1"
}
```

Alternatively (range):
```
{
  "steps": 2000,
  "seedRangeStart": 200,
  "seedRangeEnd": 202,
  "emitEvents": true,
  "outputDir": "out/exp1"
}
```

Notes
- Seeding: `ContextModel` defaults to the original constant seed for reproducibility. When provided, the CLI/config seed overrides it.
- Time step and shift length: `timeStepMinutes` and `shiftMinutes` fields are accepted by the config loader, but are not yet wired into the model. They are currently ignored (a warning may be printed). Defaults come from `Const`.

#### Event stream
When enabled, `events.jsonl` contains one JSON object per line. Each record has at least: `type`, `timestampMin`, and a top‑level integer `step`. Additional fields may include `workareaId`, `unitId`, and a `payload` with event‑specific data.
```
{"type":"SIM_START","timestampMin":0,"step":0}
{"type":"SHIFT_END","timestampMin":480,"step":96}
{"type":"SHIFT_START","timestampMin":480,"step":96}
{"type":"UNIT_STATE_CHANGED","timestampMin":485,"step":97,"workareaId":24,"unitId":"WA24-A1","payload":{"prevState":"IDLE","newState":"BUSY"}}
{"type":"ACCIDENT_OCCURRED","timestampMin":512,"step":102,"workareaId":24,"payload":{"delta":1}}
{"type":"SIM_END","timestampMin":2000,"step":1000}
```
Event types implemented: `SIM_START`, `SIM_END`, `SHIFT_START`, `SHIFT_END`, `UNIT_STATE_CHANGED`, `ACCIDENT_OCCURRED`, `PRODUCTION_COMPLETED`.

Unit state mapping and emission rules
- Canonical public state set: `{IDLE, BUSY, FAILURE, MAINTENANCE}`.
- Any internal `ACCIDENT` status is represented as `FAILURE` in `UNIT_STATE_CHANGED`. Accident details are reported via `ACCIDENT_OCCURRED` events (no `ACCIDENT` state is used).
- `UNIT_STATE_CHANGED` is emitted only when the mapped state of a unit actually changes (transition). The payload includes `prevState` and `newState`, plus the top‑level `step`.
- Unit identifiers use the stable pattern `WA<workareaId>-<Type><index>`, e.g., `WA24-A1`, `WA24-B1`, `WA24-C1`.

Other events
- `ACCIDENT_OCCURRED`: emitted when the accident counter increases. Workarea‑scoped accidents include `workareaId` and `payload.delta`.
- `PRODUCTION_COMPLETED`: emitted when cumulative production increases; payload includes `quantity`. Note: relies on a reliable `cumProduction` counter in the model.

#### KPI JSONL
For each step, `sim_...jsonl` contains a compact record with context and plant KPIs. Fields include at least: `step`, `auditDay`, `weekDay`, `clock`, `ambTemperature`, `rawMaterialQuality`, `currPower`, `totalRate`, `setpointRate`, `cumProduction`, `cumEnergy`, `cumCost`, `productEnergy`, `productCost`, and `numberAccidents`.

#### Limitations
- Production-completion events: currently emitted based on positive deltas of `cumProduction` and may depend on model updates. A future reliable per‑step completion counter would improve accuracy.
- Maintenance/failure granular events: hooks for `MAINTENANCE_START/END` and `FAILURE_OCCURRED` can be added when corresponding transitions are made explicit in model classes.
