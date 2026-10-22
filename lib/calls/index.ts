// STUB until the `calling` branch lands. Same exports as the real module:
// placeCall(callId) dials asynchronously; attachCallStreams(server) owns /twilio/*.
import type http from "node:http";
import { sql } from "../db";

export async function placeCall(callId: string): Promise<void> {
  await sql`update calls set status = 'failed', error = 'calling module not installed', ended_at = now()
            where id = ${callId} and status = 'queued'`;
}

export function attachCallStreams(server: http.Server): void {
  server.on("request", (req, res) => {
    if (!req.url?.startsWith("/twilio/")) return;
    res.writeHead(503, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "calling_not_installed" }));
  });
}
