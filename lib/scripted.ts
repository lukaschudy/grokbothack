// CALL_MODE=scripted: a written conversation played through the same events
// as a live call. For rehearsals and demos without a voice model or phone.
import { emitCall } from "./bus";
import { appendTranscript, loadCall, openingLine, saveCallResult, setCallStatus, type CallContext } from "./calls";
import { spokenDay, spokenTime } from "./time";

type Turn = { who: "agent" | "venue"; text: string };

function script(c: CallContext): Turn[] {
  const contact = process.env.SCRIPTED_CONTACT ?? "Sam";
  return [
    { who: "agent", text: openingLine(c) },
    { who: "venue", text: `Hi, yes, ${contact} here, I look after events. Go ahead.` },
    { who: "agent", text: `Thanks ${contact}. Is your main space free on ${spokenDay(c.starts_at)}, from ${spokenTime(c.starts_at)} to ${spokenTime(c.ends_at)}, for about ${c.headcount} people?` },
    { who: "venue", text: `Let me look. Yes, the main room's free that evening. It takes about ${Math.max(c.capacity ?? 0, c.headcount + 40)} standing, so ${c.headcount} is fine.` },
    { who: "agent", text: "Great. Is it free for community events, or is there a charge?" },
    { who: "venue", text: "Free for community tech events. We just need the guest list 48 hours before, and everyone out by half nine." },
    { who: "agent", text: `Perfect. Who should ${c.organiser} send the booking to?` },
    { who: "venue", text: "Email the events inbox with the date and headcount and I'll pencil you in." },
    { who: "agent", text: `Brilliant, thanks ${contact}. ${c.organiser} will be in touch by email today. Have a good evening, bye.` },
    { who: "venue", text: "Cheers, bye." }
  ];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runScriptedCall(callId: string) {
  const c = await loadCall(callId);
  if (!c) return;
  await setCallStatus(callId, "dialing");
  await sleep(1200);
  await setCallStatus(callId, "ringing");
  await sleep(3500);
  await setCallStatus(callId, "in_progress");
  await sleep(600);

  const turns = script(c);
  for (const [i, turn] of turns.entries()) {
    const id = `s${i}`;
    const words = turn.text.split(" ");
    const msPerWord = turn.who === "agent" ? 290 : 320;
    let shown = "";
    for (const [w, word] of words.entries()) {
      shown = w === 0 ? word : `${shown} ${word}`;
      emitCall(callId, { type: "transcript", id, who: turn.who, text: shown, final: false });
      for (let k = 0; k < 3; k++) {
        emitCall(callId, { type: "level", who: turn.who, level: 0.35 + Math.random() * 0.5 });
        await sleep(msPerWord / 3);
      }
    }
    emitCall(callId, { type: "transcript", id, who: turn.who, text: turn.text, final: true });
    await appendTranscript(callId, { id, who: turn.who, text: turn.text });
    if (i === 7) {
      await saveCallResult(c, {
        status: "available",
        start_time: null,
        end_time: "21:30",
        max_people: Math.max(c.capacity ?? 0, c.headcount + 40),
        price: "Free for community tech events",
        conditions: "Guest list 48 hours before; everyone out by 21:30",
        contact_name: process.env.SCRIPTED_CONTACT ?? "Sam",
        contact_role: "events",
        next_step: "Email the events inbox with the date and headcount",
        alternative: null
      });
    }
    await sleep(turn.who === "agent" ? 700 : 500);
  }
  await setCallStatus(callId, "completed");
}
