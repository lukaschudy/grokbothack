// CALL_MODE=scripted: a written conversation played through the same events
// as a live call. For rehearsals and demos without a voice model or phone.
import { emitCall } from "./bus";
import { appendTranscript, loadCall, openingLine, saveCallResult, setCallStatus, type CallContext } from "./calls";
import { spokenDay, spokenTime } from "./time";

type Turn = { who: "agent" | "venue"; text: string };

function script(c: CallContext): Turn[] {
  const contact = process.env.SCRIPTED_CONTACT ?? "Sam";
  const first = c.organiser.split(" ")[0];
  const fits = Math.max(c.capacity ?? 0, c.headcount + 40);
  return [
    { who: "agent", text: openingLine(c) },
    { who: "venue", text: `Sure, ${contact} here, I run events. Go ahead.` },
    { who: "agent", text: `Is your main room free ${spokenDay(c.starts_at)}, from ${spokenTime(c.starts_at)} to ${spokenTime(c.ends_at)}, for about ${c.headcount} people?` },
    { who: "venue", text: `Yes, that evening's free. It takes ${fits} standing, so ${c.headcount}'s fine.` },
    { who: "agent", text: "Great. Is there a charge for community events?" },
    { who: "venue", text: "No, it's free for tech meetups. We need the guest list 48 hours before, and everyone out by half nine." },
    { who: "agent", text: `Perfect, I've noted that. ${first} will email you today. Thanks ${contact}, bye!` },
    { who: "venue", text: "Cheers, bye." }
  ];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runScriptedCall(callId: string) {
  const c = await loadCall(callId);
  if (!c) return;
  await setCallStatus(callId, "dialing");
  await sleep(900);
  await setCallStatus(callId, "ringing");
  await sleep(2600);
  await setCallStatus(callId, "in_progress");
  await sleep(600);

  const turns = script(c);
  for (const [i, turn] of turns.entries()) {
    const id = `s${i}`;
    const words = turn.text.split(" ");
    const msPerWord = turn.who === "agent" ? 230 : 250;
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
    if (i === 5) {
      await saveCallResult(c, {
        status: "available",
        start_time: null,
        end_time: "21:30",
        max_people: Math.max(c.capacity ?? 0, c.headcount + 40),
        price: "Free for tech meetups",
        conditions: "Guest list 48 hours before; everyone out by 21:30",
        contact_name: process.env.SCRIPTED_CONTACT ?? "Sam",
        contact_role: "events",
        next_step: "Email the events inbox with the date and headcount",
        alternative: null
      });
    }
    await sleep(turn.who === "agent" ? 500 : 350);
  }
  await setCallStatus(callId, "completed");
}
