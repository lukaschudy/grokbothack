import { createServer } from "node:http";
import next from "next";
import { WebSocketServer } from "ws";
import { attachMediaStream } from "./bridge";
import { handleCallRoutes, phoneKeyOk } from "./routes";

const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT ?? 3000);
const app = next({ dev, hostname: "0.0.0.0", port });
const handle = app.getRequestHandler();
await app.prepare();
const nextUpgrade = app.getUpgradeHandler();

const wss = new WebSocketServer({ noServer: true });

const server = createServer(async (req, res) => {
  try {
    if (await handleCallRoutes(req, res)) return;
  } catch (e) {
    console.error("[server]", e);
    if (!res.headersSent) res.writeHead(500).end();
    return;
  }
  void handle(req, res);
});

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", "http://local");
  if (url.pathname === "/twilio/stream" || (url.pathname === "/phone/stream" && phoneKeyOk(url))) {
    wss.handleUpgrade(req, socket, head, (ws) => attachMediaStream(ws));
  } else {
    void nextUpgrade(req, socket, head);
  }
});

server.listen(port, () => console.log(`Roomline on http://localhost:${port}${dev ? " (dev)" : ""}`));
