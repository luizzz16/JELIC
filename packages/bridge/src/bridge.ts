import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import mqtt from "mqtt";
import { WebSocketServer, WebSocket } from "ws";
import { COMMANDS } from "@jelic/shared";
import type { ClientMessage, DeviceEvent, DeviceStatus, ServerMessage } from "@jelic/shared";
import { config, topics } from "./config";
import { parseEventPayload, parseOnline, parseStatus } from "./parse";

export interface Bridge {
  /** Call from an http server's "upgrade" event for the /ws path. */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void;
  health(): { ok: true; broker: boolean; online: boolean; status: DeviceStatus | null };
  close(): void;
}

/** MQTT -> WebSocket fan-out. Keeps last status + recent events in memory (run a single instance). */
export function createBridge(): Bridge {
  let status: DeviceStatus | null = null;
  let online = false;
  let brokerUp = false;
  const events: DeviceEvent[] = [];

  const wss = new WebSocketServer({ noServer: true });
  const send = (ws: WebSocket, msg: ServerMessage) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };
  const broadcast = (msg: ServerMessage) => wss.clients.forEach((c) => send(c, msg));

  const client = mqtt.connect(config.mqttUrl, {
    username: config.mqttUsername,
    password: config.mqttPassword,
    reconnectPeriod: 3000,
  });

  wss.on("connection", (ws) => {
    send(ws, { kind: "snapshot", status, online, events, broker: brokerUp });
    ws.on("message", (data) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (msg.kind !== "command" || !COMMANDS.includes(msg.action)) return;
      if (!brokerUp) return console.warn("[mqtt] command dropped, broker down");
      client.publish(topics.command, msg.action, { qos: 1 });
      console.log(`[mqtt] command -> ${topics.command}: ${msg.action}`);
    });
  });

  client.on("connect", () => {
    brokerUp = true;
    console.log(`[mqtt] connected to ${config.mqttUrl}`);
    client.subscribe(`${config.base}/#`, { qos: 1 }); // wildcard so unexpected topics get logged
    broadcast({ kind: "broker", connected: true });
  });
  client.on("close", () => {
    brokerUp = false;
    broadcast({ kind: "broker", connected: false });
  });
  client.on("error", (e) => console.error("[mqtt]", e.message));

  client.on("message", (topic, buf) => {
    const payload = buf.toString();
    const ts = Date.now();
    console.log(`[mqtt] rx ${topic} = ${payload.slice(0, 200)}`);

    if (topic === topics.status) {
      const s = parseStatus(payload);
      if (!s) return console.warn("[mqtt] bad status payload");
      status = s;
      broadcast({ kind: "status", status: s });
    } else if (topic === topics.online) {
      online = parseOnline(payload);
      broadcast({ kind: "online", online });
    } else if (topic === topics.event || topic === topics.alert) {
      const p = parseEventPayload(payload);
      if (!p) return console.warn("[mqtt] bad event payload");
      const event: DeviceEvent = { channel: topic === topics.alert ? "alert" : "event", ...p, ts };
      events.push(event);
      if (events.length > config.historyLimit) events.shift();
      broadcast({ kind: "event", event });
    }
  });

  return {
    handleUpgrade: (req, socket, head) =>
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req)),
    health: () => ({ ok: true, broker: brokerUp, online, status }),
    close: () => {
      client.end(true);
      wss.close();
    },
  };
}
