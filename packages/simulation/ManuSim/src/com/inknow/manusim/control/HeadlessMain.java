package com.inknow.manusim.control;

import com.inknow.manusim.model.ContextModel;
import com.inknow.manusim.model.PlantModel;
import com.inknow.manusim.model.SimulationEvent;
import com.inknow.manusim.model.SimulationEventListener;
import com.inknow.manusim.model.Weather;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.FileReader;
import java.io.FileWriter;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.Locale;
import java.util.ArrayList;
import java.util.List;

/**
 * Headless CLI entry point for running ManuSim without any GUI.
 * It produces a JSONL (one JSON object per line) trace with context and plant metrics.
 *
 * Usage examples:
 *   java com.inknow.manusim.control.HeadlessMain --steps 1000 --out out/sim.jsonl
 *   java com.inknow.manusim.control.HeadlessMain  # defaults
 */
public class HeadlessMain {

    public static void main(String[] args) {
        // Diagnostic: confirm which safety rate model is active at runtime
        System.err.println("SAFETY_MODEL_INDEX=" + Const.ACTOR_SAFETY_RATE_MODEL_INDEX);

        // Defaults
        int steps = 1000;
        Long baseSeed = null; // if null, ContextModel default seed is used
        int runs = 1;
        boolean emitEvents = false;
        String outputDir = "out";
        String configPath = null;
        double setpointRate = 0.0;
        boolean interactive = false;
        double wearRateSpread = 0.0;
        List<Long> explicitSeeds = new ArrayList<Long>();
        long rangeStart = Long.MIN_VALUE, rangeEnd = Long.MIN_VALUE;

        // Parse CLI
        for (int i = 0; i < args.length; i++) {
            String a = args[i];
            if ("--steps".equals(a) && i + 1 < args.length) {
                steps = Integer.parseInt(args[++i]);
            } else if ("--seed".equals(a) && i + 1 < args.length) {
                baseSeed = Long.parseLong(args[++i]);
            } else if ("--runs".equals(a) && i + 1 < args.length) {
                runs = Integer.parseInt(args[++i]);
            } else if ("--seeds".equals(a) && i + 1 < args.length) {
                String[] parts = args[++i].split(",");
                for (String p : parts) {
                    if (!p.trim().isEmpty()) explicitSeeds.add(Long.parseLong(p.trim()));
                }
            } else if ("--seedRange".equals(a) && i + 1 < args.length) {
                String[] parts = args[++i].split(":");
                if (parts.length == 2) {
                    rangeStart = Long.parseLong(parts[0]);
                    rangeEnd = Long.parseLong(parts[1]);
                }
            } else if ("--emitEvents".equals(a) && i + 1 < args.length) {
                emitEvents = Boolean.parseBoolean(args[++i]);
            } else if ("--outputDir".equals(a) && i + 1 < args.length) {
                outputDir = args[++i];
            } else if ("--setpointRate".equals(a) && i + 1 < args.length) {
                setpointRate = Double.parseDouble(args[++i]);
            } else if ("--interactive".equals(a)) {
                interactive = true;
            } else if ("--wearRateSpread".equals(a) && i + 1 < args.length) {
                wearRateSpread = Double.parseDouble(args[++i]);
                wearRateSpread = Math.min(Math.max(wearRateSpread, 0.0), 1.0); // clamp [0,1]
            } else if ("--config".equals(a) && i + 1 < args.length) {
                configPath = args[++i];
            }
        }

        // Load config JSON (very lightweight parser for simple flat fields)
        if (configPath != null) {
            Config cfg = readConfig(configPath);
            if (cfg != null) {
                // Merge: CLI > config > defaults
                if (steps == 1000 && cfg.steps != null) steps = cfg.steps;
                if (baseSeed == null && cfg.seed != null) baseSeed = cfg.seed.longValue();
                if (runs == 1 && cfg.runs != null) runs = cfg.runs;
                if (!emitEvents && cfg.emitEvents != null) emitEvents = cfg.emitEvents;
                if ("out".equals(outputDir) && cfg.outputDir != null) outputDir = cfg.outputDir;
                if (explicitSeeds.isEmpty() && cfg.seeds != null && cfg.seeds.length > 0) {
                    for (long s : cfg.seeds) explicitSeeds.add(s);
                }
                if (rangeStart == Long.MIN_VALUE && cfg.seedRangeStart != null) rangeStart = cfg.seedRangeStart;
                if (rangeEnd == Long.MIN_VALUE && cfg.seedRangeEnd != null) rangeEnd = cfg.seedRangeEnd;
            }
        }

        // Seed precedence warnings (seeds[] > seedRange > seed+runs)
        boolean hasList = !explicitSeeds.isEmpty();
        boolean hasRange = (rangeStart != Long.MIN_VALUE && rangeEnd != Long.MIN_VALUE);
        boolean hasBaseRuns = (runs > 1 || baseSeed != null);
        if (hasList && (hasRange || hasBaseRuns)) {
            System.err.println("[HeadlessMain] Warning: seeds[] provided; seedRange/seed+runs will be ignored.");
        } else if (hasRange && hasBaseRuns) {
            System.err.println("[HeadlessMain] Warning: seedRange provided; seed+runs will be ignored.");
        }

        // Build seed list
        List<Long> runSeeds = new ArrayList<Long>();
        if (hasList) {
            runSeeds.addAll(explicitSeeds);
        } else if (hasRange && rangeEnd >= rangeStart) {
            for (long s = rangeStart; s <= rangeEnd; s++) runSeeds.add(s);
        } else if (runs > 1) {
            long base = (baseSeed != null ? baseSeed : System.currentTimeMillis());
            for (int i = 0; i < runs; i++) runSeeds.add(base + i);
        } else {
            runSeeds.add(baseSeed != null ? baseSeed : Long.MIN_VALUE); // Long.MIN_VALUE => use default seed
        }

        // ── Interactive mode: single run, stdin→rate, stdout→JSONL ──
        if (interactive) {
            Long seed = runSeeds.get(0);
            if (seed != Long.MIN_VALUE) Weather.setSeed(seed);
            ContextModel context = (seed == Long.MIN_VALUE ? new ContextModel(null) : new ContextModel(null, seed));
            PlantModel plant = new PlantModel(null);

            // Reseed Unit B accident RNGs from the episode seed so accident counts vary
            // per episode. Without this, each Unit B uses its construction-time seed
            // (id × workareaId) — a fixed value — making accident draws byte-identical
            // across every episode and producing quasi-discrete frozen rewards.
            // XOR constant 0xFEEDBEEFCAFEL keeps this RNG stream distinct from both
            // the wear-rate RNG (0x5DEECE66DL) and Weather (seeded directly).
            {
                long accSeedBase = (seed == Long.MIN_VALUE ? 0L : seed);
                java.util.Random accidentRng = new java.util.Random(accSeedBase ^ 0xFEEDBEEFCAFEL);
                for (int wa = 0; wa < plant.getWorkareas().size(); wa++) {
                    plant.getWorkareas().get(wa).getUnitB().setUnitRandomSeed(accidentRng.nextLong());
                }
                System.err.println("[accidentRng] 16 Unit B RNGs reseeded from episodeSeed=" + accSeedBase);
            }

            // Per-workarea wear-rate heterogeneity (B.2).
            // When wearRateSpread > 0, each workarea's Unit C gets m_i = 1 + U(-S, +S)
            // where S = wearRateSpread, seeded deterministically from (episodeSeed, wa).
            // This is set once per episode; the OFF path (spread=0) leaves all multipliers
            // at their Unit default of 1.0, reproducing lockstep exactly.
            if (wearRateSpread > 0.0) {
                // One RNG per episode seeded from the episode seed; draw 16 sequential
                // values so each workarea gets a distinct multiplier.  Sequential draws
                // from a single LCG are well-distributed; this avoids the correlated-
                // first-value problem that arises from constructing 16 separate Random
                // objects from consecutive seeds (42*31+0, 42*31+1, …).
                long episodeSeed = (seed == Long.MIN_VALUE ? 0L : seed);
                // XOR-derived seed keeps the wear RNG's initial state clearly distinct
                // from the Weather/ContextModel RNG even when they share the same episode
                // seed. Both are separate Random instances, so they never interfere, but
                // the XOR makes the independence explicit and auditable.
                java.util.Random episodeRng = new java.util.Random(episodeSeed ^ 0x5DEECE66DL);
                System.err.println("[wearRateSpread=" + String.format(Locale.US, "%.3f", wearRateSpread) + "] multipliers:");
                for (int wa = 0; wa < plant.getWorkareas().size(); wa++) {
                    double m = 1.0 + (episodeRng.nextDouble() * 2.0 - 1.0) * wearRateSpread;
                    plant.getWorkareas().get(wa).getUnitC().setWearRateMultiplier(m);
                    System.err.println("  wa" + wa + " m=" + String.format(Locale.US, "%.4f", m));
                }
            }

            BufferedReader stdinReader = new BufferedReader(new InputStreamReader(System.in));

            // Preventive-maintenance downtime: when MAINT fires on a workarea it is
            // held OFFLINE (STATUS_MAINTENANCE, rate 0, zero production) for one full
            // shift, then returns to STATUS_ON. This gives maintenance a real
            // production cost instead of the previous one-step wear-reset hack.
            int stepsPerShift = Math.max(1, Const.SHIFTTIME_MINUTES / Const.TS_SIM_MINUTES);
            int[] maintCountdown = new int[plant.getWorkareas().size()];

            try {
                for (int step = 0; step < steps; step++) {
                    // 1. Read command from stdin
                    //    Format: "rate" or "rate MAINT waIndex"
                    //    MAINT triggers preventive maintenance (wear reset) on workarea[waIndex]
                    String line;
                    try {
                        line = stdinReader.readLine();
                    } catch (IOException e) {
                        break; // pipe closed
                    }
                    if (line == null) break; // EOF

                    double rate;
                    int maintIdx = -1; // -1 = no maintenance

                    String trimmed = line.trim();
                    if (trimmed.contains("MAINT")) {
                        String[] parts = trimmed.split("\\s+");
                        try {
                            rate = Double.parseDouble(parts[0]);
                            // Find MAINT keyword and the workarea index after it
                            for (int p = 0; p < parts.length - 1; p++) {
                                if ("MAINT".equals(parts[p])) {
                                    maintIdx = Integer.parseInt(parts[p + 1]);
                                    break;
                                }
                            }
                        } catch (Exception e) {
                            System.err.println("[HeadlessMain] Invalid MAINT command: " + line);
                            break;
                        }
                    } else {
                        try {
                            rate = Double.parseDouble(trimmed);
                        } catch (NumberFormatException e) {
                            System.err.println("[HeadlessMain] Invalid rate on stdin: " + line);
                            break;
                        }
                    }

                    // 2. Handle preventive maintenance: reset wear and take the
                    //    target workarea offline for a full shift (STATUS_MAINTENANCE).
                    if (maintIdx >= 0 && maintIdx < plant.getWorkareas().size()) {
                        plant.getWorkareas().get(maintIdx).getUnitC().setWearStatus(0.0);
                        plant.getWorkareas().get(maintIdx).setStatus(Const.STATUS_MAINTENANCE);
                        maintCountdown[maintIdx] = stepsPerShift;
                    }

                    // 3. Apply rate to all workareas EXCEPT those currently under
                    //    maintenance, which are held offline (rate 0) until their
                    //    shift-long countdown elapses.
                    plant.setSetPointRate(rate);
                    for (int wa = 0; wa < plant.getWorkareas().size(); wa++) {
                        if (maintCountdown[wa] > 0) {
                            plant.getWorkareas().get(wa).setCurrRate(0.0);
                        } else {
                            plant.getWorkareas().get(wa).setCurrRate(rate);
                        }
                    }

                    // 4. Simulate one step
                    try { plant.setCurrentStepForEvents(step); } catch (Throwable ignored) {}
                    context.simulateStep();
                    plant.simulateStep(context);

                    // 4b. Tick down maintenance timers; bring finished workareas back
                    //     online. Done after the step so a freshly-maintained workarea
                    //     stays offline for the full stepsPerShift count.
                    for (int wa = 0; wa < maintCountdown.length; wa++) {
                        if (maintCountdown[wa] > 0) {
                            maintCountdown[wa]--;
                            if (maintCountdown[wa] == 0) {
                                plant.getWorkareas().get(wa).setStatus(Const.STATUS_ON);
                            }
                        }
                    }

                    // 5. Write JSONL with wearByWorkarea to stdout and flush
                    String json = jsonLineInteractive(step, context, plant);
                    System.out.println(json);
                    System.out.flush();
                }
            } catch (Exception e) {
                // Graceful exit on any pipe/IO error
            }
            return; // exit after interactive run
        }

        // ── Batch mode (unchanged) ──

        // Prepare per-experiment folder with ISO-like, filesystem-safe timestamp
        DateTimeFormatter expFmt = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH-mm-ss");
        String expStamp = LocalDateTime.now().format(expFmt);
        Path expDirPath = Paths.get(outputDir, expStamp);
        ensureDir(expDirPath.toString());

        int runIdx = 0;
        for (Long seed : runSeeds) {
            runIdx++;
            String kpiPath = Paths.get(expDirPath.toString(), defaultKpiName(seed, runIdx)).toString();
            String evPath = Paths.get(expDirPath.toString(), defaultEventsName(seed, runIdx)).toString();
            ensureParentDir(kpiPath);

            // Create context and plant models for each run
            if (seed != Long.MIN_VALUE) Weather.setSeed(seed);
            ContextModel context = (seed == Long.MIN_VALUE ? new ContextModel(null) : new ContextModel(null, seed));
            PlantModel plant = new PlantModel(null);

            // Reseed Unit B accident RNGs — same derivation as interactive mode.
            {
                long accSeedBase = (seed == Long.MIN_VALUE ? 0L : seed);
                java.util.Random accidentRng = new java.util.Random(accSeedBase ^ 0xFEEDBEEFCAFEL);
                for (int wa = 0; wa < plant.getWorkareas().size(); wa++) {
                    plant.getWorkareas().get(wa).getUnitB().setUnitRandomSeed(accidentRng.nextLong());
                }
            }

            if (setpointRate > 0.0) {
                plant.setSetPointRate(setpointRate);
                for (int wa = 0; wa < plant.getWorkareas().size(); wa++) {
                    plant.getWorkareas().get(wa).setCurrRate(setpointRate);
                }
            }

            BufferedWriter evWriter = null;
            SimulationEventListener listener = null;
            try (BufferedWriter kpiWriter = new BufferedWriter(new FileWriter(kpiPath, false))) {
                if (emitEvents) {
                    evWriter = new BufferedWriter(new FileWriter(evPath, false));
                    final BufferedWriter finalEvWriter = evWriter;
                    listener = new SimulationEventListener() {
                        @Override
                        public void onEvent(SimulationEvent event) {
                            try {
                                finalEvWriter.write(eventToJson(event));
                                finalEvWriter.newLine();
                            } catch (IOException e) {
                                // best-effort
                            }
                        }
                    };
                    plant.addEventListener(listener);
                    // SIM_START @ step 0
                    writeSimMarker(finalEvWriter, "SIM_START", context, 0);
                }

                for (int step = 0; step < steps; step++) {
                    // propagate step to model for event payloads
                    try { plant.setCurrentStepForEvents(step); } catch (Throwable ignored) {}
                    context.simulateStep();
                    plant.simulateStep(context);

                    String json = jsonLine(step, context, plant);
                    kpiWriter.write(json);
                    kpiWriter.newLine();
                }

                if (emitEvents) {
                    writeSimMarker(evWriter, "SIM_END", context, steps);
                }
            } catch (IOException e) {
                e.printStackTrace();
                System.err.println("[HeadlessMain] Failed to write outputs to: " + kpiPath);
                System.exit(2);
            } finally {
                try {
                    if (listener != null) plant.removeEventListener(listener);
                } catch (Exception ignored) {}
                try {
                    if (evWriter != null) evWriter.close();
                } catch (IOException ignored) {}
            }

            System.out.println("[HeadlessMain] Finished run=" + runIdx + 
                    ", steps=" + steps + 
                    ", seed=" + (seed == Long.MIN_VALUE ? "default" : String.valueOf(seed)) +
                    ", kpiOut=" + kpiPath + (emitEvents ? ", eventsOut=" + evPath : ""));
        }
    }

    private static String defaultKpiName(Long seed, int runIdx) {
        DateTimeFormatter fmt = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH-mm-ss");
        String stamp = LocalDateTime.now().format(fmt);
        String seedStr = (seed == null || seed == Long.MIN_VALUE) ? "dflt" : String.valueOf(seed);
        return "sim_" + stamp + "_r" + runIdx + "_s" + seedStr + ".jsonl";
    }
    private static String defaultEventsName(Long seed, int runIdx) {
        String k = defaultKpiName(seed, runIdx);
        return k.replace(".jsonl", "_events.jsonl");
    }

    private static void ensureParentDir(String outPath) {
        try {
            Path p = Paths.get(outPath).toAbsolutePath().getParent();
            if (p != null && !Files.exists(p)) {
                Files.createDirectories(p);
            }
        } catch (IOException ignored) {}
    }

    private static void ensureDir(String dir) {
        try {
            Path p = Paths.get(dir).toAbsolutePath();
            if (p != null && !Files.exists(p)) {
                Files.createDirectories(p);
            }
        } catch (IOException ignored) {}
    }

    private static String jsonLine(int step, com.inknow.manusim.model.ContextModel ctx, com.inknow.manusim.model.PlantModel plant) {
        // Build a compact JSON object without external dependencies
        // Use Locale.US for dot as decimal separator
        Locale.setDefault(Locale.US);

        String clock = String.format("%02d:%02d", ctx.getClockMinutes().getHour(), ctx.getClockMinutes().getMinute());

        StringBuilder sb = new StringBuilder(256);
        sb.append('{');
        kv(sb, "step", step).append(',');
        kv(sb, "auditDay", ctx.getAuditDay()).append(',');
        kv(sb, "weekDay", ctx.getWeekDay()).append(',');
        kvStr(sb, "clock", clock).append(',');
        kv(sb, "ambTemperature", round(ctx.getAmbTemperature(), 4)).append(',');
        kv(sb, "rawMaterialQuality", round(ctx.getRawMaterialQuality(), 4)).append(',');

        kv(sb, "currPower", round(plant.getCurrPower(), 6)).append(',');
        kv(sb, "totalRate", round(plant.getTotalRate(), 6)).append(',');
        kv(sb, "setpointRate", round(plant.getSetpointRate(), 6)).append(',');
        kv(sb, "cumProduction", round(plant.getCumProduction(), 6)).append(',');
        kv(sb, "cumEnergy", round(plant.getCumEnergy(), 6)).append(',');
        kv(sb, "cumCost", round(plant.getCumCost(), 6)).append(',');
        kv(sb, "productEnergy", round(plant.getProductEnergy(), 6)).append(',');
        kv(sb, "productCost", round(plant.getProductCost(), 6)).append(',');
        kv(sb, "numberAccidents", plant.getNumberAccidents());
        sb.append('}');
        return sb.toString();
    }

    private static String jsonLineInteractive(int step, com.inknow.manusim.model.ContextModel ctx, com.inknow.manusim.model.PlantModel plant) {
        Locale.setDefault(Locale.US);
        String clock = String.format("%02d:%02d", ctx.getClockMinutes().getHour(), ctx.getClockMinutes().getMinute());

        StringBuilder sb = new StringBuilder(512);
        sb.append('{');
        kv(sb, "step", step).append(',');
        kv(sb, "auditDay", ctx.getAuditDay()).append(',');
        kv(sb, "weekDay", ctx.getWeekDay()).append(',');
        kvStr(sb, "clock", clock).append(',');
        kv(sb, "ambTemperature", round(ctx.getAmbTemperature(), 4)).append(',');
        kv(sb, "rawMaterialQuality", round(ctx.getRawMaterialQuality(), 4)).append(',');

        kv(sb, "currPower", round(plant.getCurrPower(), 6)).append(',');
        kv(sb, "totalRate", round(plant.getTotalRate(), 6)).append(',');
        kv(sb, "setpointRate", round(plant.getSetpointRate(), 6)).append(',');
        kv(sb, "cumProduction", round(plant.getCumProduction(), 6)).append(',');
        kv(sb, "cumEnergy", round(plant.getCumEnergy(), 6)).append(',');
        kv(sb, "cumCost", round(plant.getCumCost(), 6)).append(',');
        kv(sb, "productEnergy", round(plant.getProductEnergy(), 6)).append(',');
        kv(sb, "productCost", round(plant.getProductCost(), 6)).append(',');
        kv(sb, "numberAccidents", plant.getNumberAccidents()).append(',');

        // wearByWorkarea: unitC wear for each of the 16 workareas
        sb.append("\"wearByWorkarea\":[");
        for (int i = 0; i < plant.getWorkareas().size(); i++) {
            if (i > 0) sb.append(',');
            double wear = round(plant.getWorkareas().get(i).getUnitC().getWearStatus(), 2);
            sb.append(String.format(Locale.US, "%f", wear));
        }
        sb.append(']');

        sb.append('}');
        return sb.toString();
    }

    private static String eventToJson(SimulationEvent ev) {
        StringBuilder sb = new StringBuilder(128);
        sb.append('{');
        kvStr(sb, "type", ev.getType()).append(',');
        kv(sb, "timestampMin", (int)ev.getTimestampMin());
        // if step exists in payload, lift it to top-level for convenience
        if (ev.getPayload() != null && ev.getPayload().containsKey("step")) {
            Object st = ev.getPayload().get("step");
            if (st instanceof Number) { sb.append(','); kv(sb, "step", ((Number) st).intValue()); }
        }
        if (ev.getWorkareaId() != null) {
            sb.append(','); kv(sb, "workareaId", ev.getWorkareaId());
        }
        if (ev.getUnitId() != null) {
            sb.append(','); kvStr(sb, "unitId", ev.getUnitId());
        }
        // payload (flat map of primitives/strings)
        if (ev.getPayload() != null && !ev.getPayload().isEmpty()) {
            sb.append(','); sb.append('"').append("payload").append('"').append(':').append('{');
            boolean first = true;
            for (java.util.Map.Entry<String, Object> e : ev.getPayload().entrySet()) {
                if (!first) sb.append(','); first = false;
                sb.append('"').append(escape(e.getKey())).append('"').append(':');
                Object v = e.getValue();
                if (v instanceof Number) { sb.append(v.toString()); }
                else { sb.append('"').append(escape(String.valueOf(v))).append('"'); }
            }
            sb.append('}');
        }
        sb.append('}');
        return sb.toString();
    }

    private static void writeSimMarker(BufferedWriter w, String type, ContextModel ctx, int step) throws IOException {
        if (w == null) return;
        long ts = (long)ctx.getAuditDay() * 24L * 60L + (long)ctx.getClockMinutes().getDayMinute();
        java.util.Map<String,Object> payload = new java.util.HashMap<String,Object>();
        payload.put("step", step);
        SimulationEvent ev = new SimulationEvent(type, ts, null, null, payload);
        w.write(eventToJson(ev));
        w.newLine();
    }

    private static StringBuilder kv(StringBuilder sb, String key, int val) {
        return sb.append('"').append(key).append('"').append(':').append(val);
    }

    private static StringBuilder kv(StringBuilder sb, String key, double val) {
        // Ensure dot decimal separator
        return sb.append('"').append(key).append('"').append(':').append(String.format(Locale.US, "%f", val));
    }

    private static StringBuilder kvStr(StringBuilder sb, String key, String val) {
        return sb.append('"').append(key).append('"').append(':').append('"').append(escape(val)).append('"');
    }

    private static double round(double v, int places) {
        double p = Math.pow(10, places);
        return Math.round(v * p) / p;
    }

    private static String escape(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    // ----------------- Minimal JSON config support -----------------
    private static class Config {
        Integer steps; Long seed; Integer runs; Boolean emitEvents; String outputDir; long[] seeds; Long seedRangeStart; Long seedRangeEnd;
        Integer timeStepMinutes; Integer shiftMinutes;
    }
    private static Config readConfig(String path) {
        try (java.io.BufferedReader br = new java.io.BufferedReader(new FileReader(path))) {
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = br.readLine()) != null) sb.append(line);
            String s = sb.toString();
            Config c = new Config();
            // naive parsing for simple JSON objects with primitives/arrays
            c.steps = parseInt(s, "steps");
            c.seed = parseLong(s, "seed");
            c.runs = parseInt(s, "runs");
            c.emitEvents = parseBool(s, "emitEvents");
            c.outputDir = parseString(s, "outputDir");
            c.seeds = parseLongArray(s, "seeds");
            Long rs = parseLong(s, "seedRangeStart");
            Long re = parseLong(s, "seedRangeEnd");
            c.seedRangeStart = rs; c.seedRangeEnd = re;
            c.timeStepMinutes = parseInt(s, "timeStepMinutes");
            c.shiftMinutes = parseInt(s, "shiftMinutes");
            return c;
        } catch (Exception e) {
            System.err.println("[HeadlessMain] Failed to read config: " + path + " (" + e.getMessage() + ")");
            return null;
        }
    }
    private static Integer parseInt(String s, String key) {
        String v = extractValue(s, key);
        if (v == null) return null; try { return Integer.parseInt(v); } catch (Exception e) { return null; }
    }
    private static Long parseLong(String s, String key) {
        String v = extractValue(s, key);
        if (v == null) return null; try { return Long.parseLong(v); } catch (Exception e) { return null; }
    }
    private static Boolean parseBool(String s, String key) {
        String v = extractValue(s, key);
        if (v == null) return null; return Boolean.parseBoolean(v);
    }
    private static String parseString(String s, String key) {
        String patt = '"' + key + '"' + ':';
        int i = s.indexOf(patt);
        if (i < 0) return null;
        int q1 = s.indexOf('"', i + patt.length());
        if (q1 < 0) return null;
        int q2 = s.indexOf('"', q1 + 1);
        if (q2 < 0) return null;
        return s.substring(q1 + 1, q2);
    }
    private static long[] parseLongArray(String s, String key) {
        String patt = '"' + key + '"' + ':';
        int i = s.indexOf(patt);
        if (i < 0) return null;
        int b1 = s.indexOf('[', i + patt.length());
        int b2 = s.indexOf(']', b1 + 1);
        if (b1 < 0 || b2 < 0) return null;
        String inside = s.substring(b1 + 1, b2).trim();
        if (inside.isEmpty()) return new long[0];
        String[] parts = inside.split(",");
        long[] arr = new long[parts.length];
        for (int k = 0; k < parts.length; k++) {
            arr[k] = Long.parseLong(parts[k].trim());
        }
        return arr;
    }
    private static String extractValue(String s, String key) {
        String patt = '"' + key + '"' + ':';
        int i = s.indexOf(patt);
        if (i < 0) return null;
        int j = i + patt.length();
        // read until delimiter , } whitespace
        StringBuilder v = new StringBuilder();
        while (j < s.length()) {
            char ch = s.charAt(j);
            if (ch == ',' || ch == '}' || ch == ' ' || ch == '\n' || ch == '\r' || ch == '\t') break;
            v.append(ch);
            j++;
        }
        String out = v.toString().trim();
        if (out.isEmpty()) return null;
        // strip quotes if present
        if (out.startsWith("\"") && out.endsWith("\"")) {
            out = out.substring(1, out.length()-1);
        }
        return out;
    }
}
