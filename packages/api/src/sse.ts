import type { Response } from "express";

/**
 * Set up an SSE connection on the given response object.
 */
export function initSSE(res: Response): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
}

/**
 * Send an SSE event.
 */
export function sendSSE(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * End the SSE stream.
 */
export function endSSE(res: Response): void {
  res.write("event: done\ndata: {}\n\n");
  res.end();
}
