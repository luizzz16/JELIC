// Integrated mode: Next.js + MQTT/WebSocket bridge in ONE process (run a single instance).
import { createServer } from "node:http";
import express from "express";
import next from "next";
import { createBridge, connectDb, createApi } from "@jelic/bridge";

const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT ?? 3000);

const app = next({ dev, dir: import.meta.dirname });
const handle = app.getRequestHandler();
await app.prepare();
await connectDb();
const bridge = createBridge();

const web = express();
web.get("/health", (_req, res) => void res.json(bridge.health()));
web.use("/api", createApi(bridge));
web.use((req, res) => void handle(req, res));
const server = createServer(web);
// Next attaches its own "upgrade" listener on the first HTTP request (HMR in dev), so we must NOT call
// its upgrade handler ourselves (double handling breaks HMR). We only claim /ws and hide it from Next.
const emit = server.emit.bind(server);
server.emit = ((event: string, ...args: unknown[]) => {
  if (event === "upgrade") {
    const [req, socket, head] = args as Parameters<typeof bridge.handleUpgrade>;
    if (req.url?.split("?")[0] === "/ws") {
      bridge.handleUpgrade(req, socket, head);
      return true;
    }
  }
  return emit(event, ...args);
}) as typeof server.emit;
server.listen(port, () => console.log(`[web] http://localhost:${port} (integrated, ws at /ws)`));
