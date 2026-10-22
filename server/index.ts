// Boot the Mates Rates server: API + static site + calling (Twilio webhooks and media WebSocket).
import { attachCallStreams, placeCall } from "../lib/calls";
import { sql } from "../lib/db";
import { createApp } from "./app";

const port = Number(process.env.PORT ?? 8787);
const server = createApp({ placeCall });
attachCallStreams(server);
server.listen(port, () => {
  console.log(`Mates Rates on http://localhost:${port}${process.env.PUBLIC_URL ? ` (public ${process.env.PUBLIC_URL})` : ""}`);
  if (!process.env.RESEND_API_KEY || !process.env.MAIL_FROM) console.log("Email not configured: requests stay as drafts");
});

const stop = () => server.close(() => sql.end().finally(() => process.exit(0)));
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
