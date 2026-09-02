import Database from "better-sqlite3";
import path from "node:path";

let db: Database.Database | null = null;

export function getDb(dbPath?: string): Database.Database {
  if (db) return db;
  const resolved = dbPath ?? path.join(process.cwd(), "dt.sqlite");
  db = new Database(resolved);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS experiments (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
      config_json   TEXT    NOT NULL,
      status        TEXT    NOT NULL DEFAULT 'pending'
    );

    CREATE TABLE IF NOT EXISTS runs (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      experiment_id   INTEGER NOT NULL REFERENCES experiments(id),
      agent_type      TEXT    NOT NULL,
      hyperparams_json TEXT   NOT NULL,
      total_episodes  INTEGER NOT NULL DEFAULT 0,
      final_reward    REAL
    );

    CREATE TABLE IF NOT EXISTS episodes (
      id                      INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id                  INTEGER NOT NULL REFERENCES runs(id),
      episode_num             INTEGER NOT NULL,
      action                  INTEGER NOT NULL,
      action_name             TEXT    NOT NULL,
      reward                  REAL    NOT NULL,
      avg_production_rate     REAL    NOT NULL,
      total_accidents         INTEGER NOT NULL,
      avg_product_cost        REAL    NOT NULL,
      energy_per_part         REAL,
      epsilon                 REAL,
      q_table_size            INTEGER,
      unplanned_failures      INTEGER,
      unplanned_failure_free  INTEGER,
      execution_mode          TEXT
    );

    CREATE TABLE IF NOT EXISTS kpi_steps (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      episode_id  INTEGER NOT NULL REFERENCES episodes(id),
      step        INTEGER NOT NULL,
      total_rate  REAL    NOT NULL,
      product_cost REAL   NOT NULL,
      num_accidents INTEGER NOT NULL
    );
  `);

  // v2: add energy_per_part column to episodes (idempotent)
  const cols = db.prepare("PRAGMA table_info(episodes)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "energy_per_part")) {
    db.exec("ALTER TABLE episodes ADD COLUMN energy_per_part REAL");
  }

  // v3: add full KPI columns to kpi_steps for plant visual (idempotent)
  const kpiCols = db.prepare("PRAGMA table_info(kpi_steps)").all() as { name: string }[];
  const newKpiCols = [
    { name: "amb_temperature",      type: "REAL" },
    { name: "raw_material_quality", type: "REAL" },
    { name: "cum_production",       type: "REAL" },
    { name: "cum_energy",           type: "REAL" },
    { name: "cum_cost",             type: "REAL" },
    { name: "curr_power",           type: "REAL" },
    { name: "setpoint_rate",        type: "REAL" },
    { name: "clock",                type: "TEXT" },
  ];
  for (const col of newKpiCols) {
    if (!kpiCols.some((c) => c.name === col.name)) {
      db.exec(`ALTER TABLE kpi_steps ADD COLUMN ${col.name} ${col.type}`);
    }
  }

  // v4: add wear_by_workarea for interactive mode degradation tracking
  const kpiCols4 = db.prepare("PRAGMA table_info(kpi_steps)").all() as { name: string }[];
  if (!kpiCols4.some((c) => c.name === "wear_by_workarea")) {
    db.exec("ALTER TABLE kpi_steps ADD COLUMN wear_by_workarea TEXT");
  }

  // v5: add max_wear_at_maint to episodes — avg maxWear when maintenance was triggered
  const epCols5 = db.prepare("PRAGMA table_info(episodes)").all() as { name: string }[];
  if (!epCols5.some((c) => c.name === "max_wear_at_maint")) {
    db.exec("ALTER TABLE episodes ADD COLUMN max_wear_at_maint REAL");
  }

  // v6: unplanned_failures (count), unplanned_failure_free (0/1), execution_mode ('interactive'|'batch')
  const epCols6 = db.prepare("PRAGMA table_info(episodes)").all() as { name: string }[];
  if (!epCols6.some((c) => c.name === "unplanned_failures")) {
    db.exec("ALTER TABLE episodes ADD COLUMN unplanned_failures INTEGER");
  }
  if (!epCols6.some((c) => c.name === "unplanned_failure_free")) {
    db.exec("ALTER TABLE episodes ADD COLUMN unplanned_failure_free INTEGER");
  }
  if (!epCols6.some((c) => c.name === "execution_mode")) {
    db.exec("ALTER TABLE episodes ADD COLUMN execution_mode TEXT");
  }
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
