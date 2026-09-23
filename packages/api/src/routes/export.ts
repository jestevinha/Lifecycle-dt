import { Router } from "express";
import { getDb } from "@dt/engine";

export const exportRouter = Router();

/** Export all episodes for an experiment as CSV */
exportRouter.get("/:experimentId/csv", (req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT
      r.agent_type,
      r.reward_profile,
      e.episode_num,
      e.action,
      e.action_name,
      e.reward,
      e.avg_production_rate,
      e.total_accidents,
      e.avg_product_cost,
      e.epsilon,
      e.q_table_size
    FROM episodes e
    JOIN runs r ON e.run_id = r.id
    WHERE r.experiment_id = ?
    ORDER BY r.agent_type, e.episode_num
  `).all(req.params.experimentId) as Record<string, unknown>[];

  if (rows.length === 0) {
    return res.status(404).json({ error: "No episodes found" });
  }

  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(","),
    ...rows.map(r => headers.map(h => r[h] ?? "").join(",")),
  ].join("\n");

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename=experiment_${req.params.experimentId}.csv`);
  res.send(csv);
});

/** Export as PDF (placeholder — requires dashboard URL) */
exportRouter.get("/:experimentId/pdf", async (req, res) => {
  try {
    const puppeteer = await import("puppeteer");
    const browser = await puppeteer.default.launch({ headless: true });
    const page = await browser.newPage();

    const dashboardUrl = `http://localhost:5173/experiment/${req.params.experimentId}`;
    await page.goto(dashboardUrl, { waitUntil: "networkidle0", timeout: 30_000 });
    const pdf = await page.pdf({ format: "A4", landscape: true, printBackground: true });

    await browser.close();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=experiment_${req.params.experimentId}.pdf`);
    res.send(pdf);
  } catch (err) {
    res.status(500).json({ error: "PDF generation failed", details: String(err) });
  }
});
