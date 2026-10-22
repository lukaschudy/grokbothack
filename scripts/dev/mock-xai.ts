// Stand-in for wss://api.x.ai/v1/realtime, for testing the call bridge without a key.
// Plays a short scripted agent: intro, waits for the venue to speak, records availability, says bye, ends.
import { WebSocketServer } from "ws";

const port = Number(process.env.MOCK_XAI_PORT ?? 3999);
const wss = new WebSocketServer({ port });

function tone(ms: number): string {
  const n = (ms / 1000) * 8000;
  const out = Buffer.alloc(n);
  for (let i = 0; i < n; i++) {
    const s = Math.sin((2 * Math.PI * 330 * i) / 8000) * 0.4 * 32767;
    const sign = s < 0 ? 0x80 : 0;
    let v = Math.min(32635, Math.abs(s) + 0x84);
    let e = 7;
    for (let m = 0x4000; (v & m) === 0 && e > 0; e--, m >>= 1);
    out[i] = ~(sign | (e << 4) | ((v >> (e + 3)) & 0x0f)) & 0xff;
  }
  return out.toString("base64");
}

wss.on("connection", (ws) => {
  let heard = 0;
  let stage = "intro";
  let item = 0;
  const send = (m: object) => ws.send(JSON.stringify(m));
  const say = (text: string, fn?: { name: string; args: object }) => {
    const id = `item_${++item}`;
    send({ type: "response.created", response: { id: `resp_${item}` } });
    for (let i = 0; i < 4; i++) send({ type: "response.output_audio.delta", item_id: id, delta: tone(250) });
    for (const w of text.split(" ")) send({ type: "response.output_audio_transcript.delta", item_id: id, delta: `${w} ` });
    send({ type: "response.output_audio_transcript.done", item_id: id, transcript: text });
    const output = fn ? [{ type: "function_call", name: fn.name, call_id: `call_${item}`, arguments: JSON.stringify(fn.args) }] : [];
    if (fn) send({ type: "response.function_call_arguments.done", name: fn.name, call_id: `call_${item}`, arguments: JSON.stringify(fn.args) });
    send({ type: "response.done", response: { output } });
  };
  ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === "session.update") send({ type: "session.updated", session: m.session });
    else if (m.type === "conversation.item.create" && m.item?.type === "force_message") {
      say(m.item.content[0].text);
      stage = "listening";
    } else if (m.type === "input_audio_buffer.append" && stage === "listening") {
      heard += Buffer.from(m.audio, "base64").length;
      if (heard >= 8000 * 1.5) {
        stage = "answered";
        send({ type: "input_audio_buffer.speech_started", item_id: "venue_1" });
        send({ type: "conversation.item.input_audio_transcription.updated", item_id: "venue_1", transcript: "Yes, the main room is free" });
        send({ type: "conversation.item.input_audio_transcription.completed", item_id: "venue_1", transcript: "Yes, the main room is free that night. It holds 120, free for community events, guest list 48 hours before. I'm Priya, events manager." });
        setTimeout(() => say("Great, thanks Priya, I'll note that down.", {
          name: "record_availability",
          args: { status: "available", start_time: "18:30", end_time: "21:30", max_people: 120, price: "Free for community events", conditions: "Guest list 48 hours before", contact_name: "Priya", contact_role: "events manager", next_step: "Email the events inbox", alternative: null }
        }), 300);
      }
    } else if (m.type === "response.create" && stage === "answered") {
      stage = "bye";
      say("Thanks Priya, they'll be in touch by email. Bye!", { name: "end_call", args: { reason: "done" } });
    }
  });
});
console.log(`mock xAI realtime on ws://localhost:${port}`);
