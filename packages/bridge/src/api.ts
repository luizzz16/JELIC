import express, { Router, type NextFunction, type Request, type Response } from "express";

import { config } from "./config";
import type { Bridge } from "./bridge";
import { CommandModel, EventModel, StatusLogModel, dbReady } from "./db";

const num = (v: unknown, def: number, min: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.trunc(n))) : def;
};

/** Rango de fechas ?from=&to= (ISO). Sin `from` -> sin límite inferior. */
function range(q: Request["query"]) {
  const r: { $gte?: Date; $lte?: Date } = {};
  const from = q.from ? new Date(String(q.from)) : null;
  const to = q.to ? new Date(String(q.to)) : null;
  if (from && !isNaN(+from)) r.$gte = from;
  if (to && !isNaN(+to)) r.$lte = to;
  return Object.keys(r).length ? r : undefined;
}

const needDb = (_req: Request, res: Response, next: NextFunction) =>
  dbReady() ? next() : void res.status(503).json({ error: "database_unavailable" });

/** Router REST montado en /api. */
export function createApi(bridge: Bridge) {
  const api = Router();

  api.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", config.corsOrigin);
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return void res.sendStatus(204);
    next();
  });
  api.use(express.json());

  api.get("/health", (_req, res) => res.json(bridge.health()));

  // Estado actual del dispositivo (en memoria, último mensaje MQTT).
  api.get("/status", (_req, res) => {
    const { status, online, broker } = bridge.health();
    res.json({ device: config.deviceId, online, broker, status });
  });

  // Historial de estados: ?from&to&page&limit
  api.get("/status/history", needDb, async (req, res, next) => {
    try {
      const limit = num(req.query.limit, 50, 1, 500);
      const page = num(req.query.page, 1, 1, 100000);
      const filter: Record<string, unknown> = { device: config.deviceId };
      const ts = range(req.query);
      if (ts) filter.ts = ts;
      const [items, total] = await Promise.all([
        StatusLogModel.find(filter).sort({ ts: -1 }).skip((page - 1) * limit).limit(limit).lean(),
        StatusLogModel.countDocuments(filter),
      ]);
      res.json({ page, limit, total, items });
    } catch (e) {
      next(e);
    }
  });

  // Eventos y alertas: ?channel=event|alert&type=&from&to&page&limit
  api.get("/events", needDb, async (req, res, next) => {
    try {
      const limit = num(req.query.limit, 50, 1, 500);
      const page = num(req.query.page, 1, 1, 100000);
      const filter: Record<string, unknown> = { device: config.deviceId };
      if (req.query.channel === "event" || req.query.channel === "alert") filter.channel = req.query.channel;
      if (typeof req.query.type === "string" && req.query.type) filter.type = req.query.type;
      const ts = range(req.query);
      if (ts) filter.ts = ts;
      const [items, total] = await Promise.all([
        EventModel.find(filter).sort({ ts: -1 }).skip((page - 1) * limit).limit(limit).lean(),
        EventModel.countDocuments(filter),
      ]);
      res.json({ page, limit, total, items });
    } catch (e) {
      next(e);
    }
  });

  api.get("/events/:id", needDb, async (req, res, next) => {
    try {
      if (!/^[a-f0-9]{24}$/i.test(String(req.params.id))) return void res.status(400).json({ error: "invalid_id" });
      const doc = await EventModel.findById(String(req.params.id)).lean();
      doc ? res.json(doc) : res.status(404).json({ error: "not_found" });
    } catch (e) {
      next(e);
    }
  });

  // Estadísticas para el dashboard: ?hours=24 (ventana, máx 720)
  api.get("/stats", needDb, async (req, res, next) => {
    try {
      const hours = num(req.query.hours, 24, 1, 720);
      const since = new Date(Date.now() - hours * 3_600_000);
      const match = { device: config.deviceId, ts: { $gte: since } };
      const [byType, byHour, totals, rssi] = await Promise.all([
        EventModel.aggregate([
          { $match: match },
          { $group: { _id: { channel: "$channel", type: "$type" }, count: { $sum: 1 } } },
          { $project: { _id: 0, channel: "$_id.channel", type: "$_id.type", count: 1 } },
          { $sort: { count: -1 } },
        ]),
        EventModel.aggregate([
          { $match: match },
          { $group: { _id: { $dateToString: { format: "%Y-%m-%dT%H:00:00Z", date: "$ts" } }, events: { $sum: 1 }, alerts: { $sum: { $cond: [{ $eq: ["$channel", "alert"] }, 1, 0] } } } },
          { $project: { _id: 0, hour: "$_id", events: 1, alerts: 1 } },
          { $sort: { hour: 1 } },
        ]),
        EventModel.aggregate([
          { $match: match },
          { $group: { _id: "$channel", count: { $sum: 1 } } },
        ]),
        StatusLogModel.aggregate([
          { $match: match },
          { $group: { _id: { $dateToString: { format: "%Y-%m-%dT%H:00:00Z", date: "$ts" } }, rssi: { $avg: "$rssi" } } },
          { $project: { _id: 0, hour: "$_id", rssi: { $round: ["$rssi", 1] } } },
          { $sort: { hour: 1 } },
        ]),
      ]);
      const count = (c: string) => totals.find((t) => t._id === c)?.count ?? 0;
      res.json({ hours, since, events: count("event"), alerts: count("alert"), byType, byHour, rssi });
    } catch (e) {
      next(e);
    }
  });

  // Auditoría de comandos enviados.
  api.get("/commands", needDb, async (req, res, next) => {
    try {
      const limit = num(req.query.limit, 50, 1, 500);
      const items = await CommandModel.find({ device: config.deviceId }).sort({ ts: -1 }).limit(limit).lean();
      res.json({ limit, items });
    } catch (e) {
      next(e);
    }
  });

  // Enviar un comando al dispositivo: { "action": "LOCK" }
  api.post("/commands", (req, res) => {
    const action = req.body?.action;
    if (typeof action !== "string") return void res.status(400).json({ error: "action_required" });
    const r = bridge.sendCommand(action);
    if (r.ok) return void res.status(202).json({ accepted: true, action });
    const code = r.reason === "invalid" ? 400 : 503;
    res.status(code).json({ accepted: false, action, reason: r.reason });
  });

  api.use((_req, res) => void res.status(404).json({ error: "not_found" }));
  api.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[api]", err.message);
    res.status(500).json({ error: "internal_error" });
  });

  return api;
}
