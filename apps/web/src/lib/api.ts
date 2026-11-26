/** Base de la API REST. Vacío = mismo origen (modo integrado). En GitHub Pages: URL del backend. */
const BASE = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");

export interface EventRow { _id: string; device: string; channel: "event" | "alert"; type: string; detail: string; ts: string }
export interface Page<T> { page: number; limit: number; total: number; items: T[] }
export interface Stats {
  hours: number; events: number; alerts: number;
  byType: { channel: string; type: string; count: number }[];
  byHour: { hour: string; events: number; alerts: number }[];
  rssi: { hour: string; rssi: number }[];
}

async function get<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") q.set(k, String(v));
  const res = await fetch(`${BASE}/api${path}${q.size ? `?${q}` : ""}`, { cache: "no-store" });
  if (!res.ok) throw new Error(res.status === 503 ? "La base de datos no está disponible." : `Error ${res.status}`);
  return res.json();
}

export const fetchEvents = (p: { page: number; limit: number; channel?: string; type?: string; from?: string; to?: string }) =>
  get<Page<EventRow>>("/events", p);
export const fetchStats = (hours: number) => get<Stats>("/stats", { hours });
