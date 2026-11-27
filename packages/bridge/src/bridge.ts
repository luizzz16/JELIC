import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import mqtt from "mqtt";
import { WebSocketServer, WebSocket } from "ws";
import { COMMANDS } from "@jelic/shared";
import type { ClientMessage, DeviceEvent, DeviceStatus, LockCommand, ServerMessage } from "@jelic/shared";
import { config, topics } from "./config";
import { parseEventPayload, parseOnline, parseStatus } from "./parse";
import { CommandModel, EventModel, StatusLogModel, dbReady } from "./db";

/** Guarda en Mongo sin bloquear el tiempo real; un fallo de BD nunca tumba el bridge. */
function persist(p: Promise<unknown>) {
  p.catch((e) => console.error("[db] error al guardar:", (e as Error).message));
}

export type CommandResult = { ok: boolean; reason?: "invalid" | "broker_down" };

export interface Bridge {
  /** Call from an http server's "upgrade" event for the /ws path. */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void;
  /** Envía un comando al ESP32 (misma validación que por WebSocket). */
  sendCommand(action: string): CommandResult;
  health(): { ok: true; broker: boolean; online: boolean; db: boolean; status: DeviceStatus | null };
  close(): void;
}

/** MQTT -> WebSocket fan-out + persistencia en MongoDB. Keeps last status + recent events in memory (run a single instance). */
export function createBridge(): Bridge {
  let status: DeviceStatus | null = null;
  let online = false;
  let brokerUp = false;
  let lastStatusSave = 0;
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

  function sendCommand(action: string): CommandResult {
    if (!COMMANDS.includes(action as LockCommand)) return { ok: false, reason: "invalid" };
    const log = (accepted: boolean, reason?: string) => {
      if (dbReady()) persist(CommandModel.create({ device: config.deviceId, action, accepted, reason }));
    };
    if (!brokerUp) {
      console.warn("[mqtt] command dropped, broker down");
      log(false, "broker_down");
      return { ok: false, reason: "broker_down" };
    }
    client.publish(topics.command, action, { qos: 1 });
    console.log(`[mqtt] command -> ${topics.command}: ${action}`);
    log(true);
    return { ok: true };
  }

  wss.on("connection", (ws) => {
    send(ws, { kind: "snapshot", status, online, events, broker: brokerUp });
    ws.on("message", (data) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (msg.kind !== "command") return;
      sendCommand(msg.action);
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
      const changed =
        !status || status.door !== s.door || status.latch !== s.latch || status.presence !== s.presence || status.alarm !== s.alarm;
      status = s;
      // Se guarda solo si cambió algo relevante o pasó el intervalo (evita lecturas idénticas repetidas).
      if (dbReady() && (changed || ts - lastStatusSave >= config.statusSaveMs)) {
        lastStatusSave = ts;
        persist(StatusLogModel.create({ ...s, device: s.device || config.deviceId, ts: new Date(ts) }));
      }
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
      if (dbReady()) {
        persist(
          EventModel.create({ device: config.deviceId, channel: event.channel, type: event.type, detail: event.detail, ts: new Date(ts) }),
        );
      }
      broadcast({ kind: "event", event });
    }
  });

  return {
    handleUpgrade: (req, socket, head) =>
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req)),
    sendCommand,
    health: () => ({ ok: true, broker: brokerUp, online, db: dbReady(), status }),
    close: () => {
      client.end(true);
      wss.close();
    },
  };
}
