import express from "express";
import cors from "cors";
import { getDb } from "@dt/engine";
import { experimentsRouter } from "./routes/experiments.js";
import { exportRouter } from "./routes/export.js";
import { simulationsRouter } from "./routes/simulations.js";

const app = express();
const PORT = process.env.PORT ?? 3001;

app.use(cors());
app.use(express.json());

// Initialize DB on startup
getDb();

app.use("/api/experiments", experimentsRouter);
app.use("/api/export", exportRouter);
app.use("/api/simulations", simulationsRouter);

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.listen(PORT, () => {
  console.log(`API server listening on http://localhost:${PORT}`);
});
