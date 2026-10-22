// Acts as the venue's phone: waits for a ring, answers, and "speaks" a tone.
import WebSocket from "ws";

const base = process.env.BASE ?? "http://localhost:3000";
const res = await fetch(`${base}/phone/events`);
const reader = res.body!.getReader();
let buf = "";
let ring: { callId: string; token: string } | null = null;
while (!ring) {
  const { value, done } = await reader.read();
  if (done) throw new Error("event stream closed");
  buf += new TextDecoder().decode(value);
  for (const chunk of buf.split("\n\n")) {
    const line = chunk.split("\n").find((l) => l.startsWith("data: "));
    if (!line) continue;
    const e = JSON.parse(line.slice(6));
    if (e.type === "ring") ring = e;
  }
}
reader.cancel();
console.log("ringing:", ring.callId);
await new Promise((r) => setTimeout(r, 1500));
const ws = new WebSocket(`${base.replace("http", "ws")}/phone/stream`);
let agentBytes = 0;
ws.on("open", () => {
  ws.send(JSON.stringify({ event: "start", start: { streamSid: "sim", callSid: `virtual:${ring!.token}`, customParameters: { callId: ring!.callId } } }));
  console.log("answered");
  let t = 0;
  const timer = setInterval(() => {
    // 20 ms frames of a loud-ish tone once the intro has had time to play.
    const frame = Buffer.alloc(160, t > 100 ? 0x20 : 0xff);
    ws.send(JSON.stringify({ event: "media", streamSid: "sim", media: { track: "inbound", payload: frame.toString("base64") } }));
    if (++t > 600) clearInterval(timer);
  }, 20);
  ws.on("close", () => clearInterval(timer));
});
ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.event === "media") agentBytes += Buffer.from(m.media.payload, "base64").length;
  else console.log("server:", m.event);
});
ws.on("close", () => { console.log(`hung up; received ${(agentBytes / 8000).toFixed(1)}s of agent audio`); process.exit(0); });
