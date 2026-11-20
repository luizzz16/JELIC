import type { DeviceStatus } from "@jelic/shared";

function json(payload: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(payload);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function parseStatus(payload: string): DeviceStatus | null {
  const o = json(payload);
  if (!o || (o.door !== "open" && o.door !== "closed") || (o.latch !== "locked" && o.latch !== "unlocked")) return null;
  return {
    device: String(o.device ?? ""),
    door: o.door,
    latch: o.latch,
    presence: Boolean(o.presence),
    alarm: Boolean(o.alarm),
    rssi: Number(o.rssi ?? 0),
    sd: Boolean(o.sd),
    ts: String(o.ts ?? ""),
  };
}

export function parseEventPayload(payload: string): { type: string; detail: string } | null {
  const o = json(payload);
  if (!o || typeof o.type !== "string") return null;
  return { type: o.type, detail: String(o.detail ?? "") };
}

export const parseOnline = (payload: string) => payload.trim().toLowerCase() === "online";
