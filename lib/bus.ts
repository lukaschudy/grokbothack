import { EventEmitter } from "node:events";

export type CallEvent =
  | { type: "status"; status: string; at: string }
  | { type: "level"; who: "agent" | "venue"; level: number }
  | { type: "transcript"; id: string; who: "agent" | "venue"; text: string; final: boolean }
  | { type: "result"; result: CallResult }
  | { type: "error"; message: string };

export type CallResult = {
  status: "available" | "unavailable" | "partial";
  start_time: string | null;
  end_time: string | null;
  max_people: number | null;
  price: string | null;
  conditions: string | null;
  contact_name: string | null;
  contact_role: string | null;
  next_step: string | null;
  alternative: string | null;
  availability_id?: string;
  recorded_at?: string;
};

// One process hosts Next and the call bridge; keep a single emitter on
// globalThis so bundled and unbundled copies of this module share it.
const g = globalThis as unknown as { roomlineBus?: EventEmitter };
export const bus = g.roomlineBus ?? new EventEmitter();
bus.setMaxListeners(200);
g.roomlineBus = bus;

export const emitCall = (callId: string, event: CallEvent) => bus.emit(`call:${callId}`, event);
