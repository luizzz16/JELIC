// Integrated mode: Next.js + MQTT/WebSocket bridge in ONE process (run a single instance).
import { createServer } from "node:http";
import next from "next";
import { createBridge } from "@jelic/bridge";

const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT ?? 3000);

const app = next({ dev, dir: import.meta.dirname });
const handle = app.getRequestHandler();
await app.prepare();
const bridge = createBridge();

const server = createServer((req, res) => {
  if (req.url?.split("?")[0] === "/health") {
    res.setHeader("content-type", "application/json");
    return void res.end(JSON.stringify(bridge.health()));
  }
  void handle(req, res);
});
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
