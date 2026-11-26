"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EVENT_TEXT } from "../../lib/events";
import { fetchEvents, fetchStats, type EventRow, type Page, type Stats } from "../../lib/api";

const RANGES = [{ h: 6, l: "6 h" }, { h: 24, l: "24 h" }, { h: 168, l: "7 días" }, { h: 720, l: "30 días" }];
const PAGE_SIZE = 20;
const title = (t: string) => EVENT_TEXT[t]?.title ?? t;
const fmt = (iso: string) =>
  new Date(iso).toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

/** Barras (eventos totales, con las alertas superpuestas en rojo) por hora o por día, en SVG puro. */
function HourChart({ data, hours }: { data: Stats["byHour"]; hours: number }) {
  const W = 640, H = 180, P = { l: 28, r: 8, t: 8, b: 22 };
  if (!data.length) return <p className="empty">Sin datos en este rango.</p>;
  // Con rangos largos se agrupa por día para que las barras sigan siendo legibles.
  const byDay = hours > 48;
  const buckets = new Map<string, { events: number; alerts: number }>();
  for (const d of data) {
    const k = byDay ? d.hour.slice(0, 10) : d.hour;
    const b = buckets.get(k) ?? { events: 0, alerts: 0 };
    b.events += d.events;
    b.alerts += d.alerts;
    buckets.set(k, b);
  }
  const rows = [...buckets.entries()];
  const max = Math.max(1, ...rows.map(([, b]) => b.events));
  const bw = (W - P.l - P.r) / rows.length;
  const y = (v: number) => H - P.b - (v / max) * (H - P.t - P.b);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Eventos por periodo">
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line x1={P.l} x2={W - P.r} y1={y(max * f)} y2={y(max * f)} className="grid" />
          <text x={P.l - 4} y={y(max * f) + 3} textAnchor="end">{Math.round(max * f)}</text>
        </g>
      ))}
      {rows.map(([k, b], i) => {
        const x = P.l + i * bw + bw * 0.15;
        const w = bw * 0.7;
        return (
          <g key={k}>
            <title>{`${k.replace("T", " ").replace(":00:00Z", "h")}: ${b.events} eventos, ${b.alerts} alertas`}</title>
            <rect x={x} y={y(b.events)} width={w} height={H - P.b - y(b.events)} className="bar" />
            {b.alerts > 0 && <rect x={x} y={y(b.alerts)} width={w} height={H - P.b - y(b.alerts)} className="bar alert" />}
            {(rows.length <= 12 || i % Math.ceil(rows.length / 8) === 0) && (
              <text x={x + w / 2} y={H - 6} textAnchor="middle">{byDay ? k.slice(5) : `${k.slice(11, 13)}h`}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** Línea de RSSI (calidad de señal) promedio por hora. */
function RssiChart({ data }: { data: Stats["rssi"] }) {
  const W = 640, H = 120, P = { l: 34, r: 8, t: 8, b: 8 };
  if (data.length < 2) return <p className="empty">Se necesitan al menos 2 lecturas.</p>;
  const vals = data.map((d) => d.rssi);
  const lo = Math.min(...vals) - 2;
  const hi = Math.max(...vals) + 2;
  const x = (i: number) => P.l + (i / (data.length - 1)) * (W - P.l - P.r);
  const y = (v: number) => P.t + (1 - (v - lo) / (hi - lo)) * (H - P.t - P.b);
  const path = data.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d.rssi).toFixed(1)}`).join("");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="RSSI promedio">
      {[lo, (lo + hi) / 2, hi].map((v) => (
        <g key={v}>
          <line x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} className="grid" />
          <text x={P.l - 4} y={y(v) + 3} textAnchor="end">{Math.round(v)}</text>
        </g>
      ))}
      <path d={path} className="line" />
      {data.map((d, i) => (
        <circle key={d.hour} cx={x(i)} cy={y(d.rssi)} r="2.5" className="dot">
          <title>{`${d.hour.slice(5, 13).replace("T", " ")}h: ${d.rssi} dBm`}</title>
        </circle>
      ))}
    </svg>
  );
}

export default function Historial() {
  const [hours, setHours] = useState(24);
  const [channel, setChannel] = useState("");
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);
  const [stats, setStats] = useState<Stats | null>(null);
  const [rows, setRows] = useState<Page<EventRow> | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const from = new Date(Date.now() - hours * 3600e3).toISOString();
      const [s, e] = await Promise.all([
        fetchStats(hours),
        fetchEvents({ page, limit: PAGE_SIZE, channel: channel || undefined, type: type || undefined, from }),
      ]);
      setStats(s);
      setRows(e);
      setError("");
    } catch (err) {
      const m = (err as Error).message;
      setError(m === "Failed to fetch" ? "No se pudo contactar la API." : m);
    } finally {
      setLoading(false);
    }
  }, [hours, channel, type, page]);

  useEffect(() => { void load(); }, [load]);
  // Refresco periódico: el historial se mantiene casi en tiempo real sin recargar la página.
  useEffect(() => {
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, [load]);

  const types = useMemo(() => [...new Set((stats?.byType ?? []).map((t) => t.type))].sort(), [stats]);
  const pages = rows ? Math.max(1, Math.ceil(rows.total / rows.limit)) : 1;
  const top = stats?.byType.slice(0, 6) ?? [];
  const topMax = Math.max(1, ...top.map((t) => t.count));

  return (
    <main className="hist">
      <header>
        <div className="brand">Jelic <span>Historial</span></div>
        <a className="navlink" href="/">← En vivo</a>
      </header>

      <div className="hfilters">
        <div className="seg" role="group" aria-label="Rango">
          {RANGES.map((r) => (
            <button key={r.h} className={hours === r.h ? "on" : ""} onClick={() => { setHours(r.h); setPage(1); }}>{r.l}</button>
          ))}
        </div>
        <select value={channel} onChange={(e) => { setChannel(e.target.value); setPage(1); }} aria-label="Canal">
          <option value="">Eventos y alertas</option>
          <option value="event">Solo eventos</option>
          <option value="alert">Solo alertas</option>
        </select>
        <select value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} aria-label="Tipo">
          <option value="">Todos los tipos</option>
          {types.map((t) => (<option key={t} value={t}>{title(t)}</option>))}
        </select>
      </div>

      {error && <div className="notice" role="alert">{error}</div>}

      <section className="kpis">
        <div className="card kpi"><span className="mono">Eventos</span><b>{stats?.events ?? "–"}</b></div>
        <div className="card kpi hot"><span className="mono">Alertas</span><b>{stats?.alerts ?? "–"}</b></div>
        <div className="card kpi"><span className="mono">Tipos distintos</span><b>{stats ? new Set(stats.byType.map((t) => t.type)).size : "–"}</b></div>
      </section>

      <div className="grid2">
        <section className="card panel">
          <div className="section-title">
            <h2>Actividad</h2>
            <span className="mono"><i className="lg" />eventos<i className="lg alert" />alertas</span>
          </div>
          <HourChart data={stats?.byHour ?? []} hours={hours} />
        </section>
        <section className="card panel">
          <div className="section-title"><h2>Más frecuentes</h2></div>
          {top.length === 0 && <p className="empty">Sin datos.</p>}
          {top.map((t) => (
            <div key={`${t.channel}-${t.type}`} className="hbar">
              <span>{title(t.type)}</span>
              <div><i className={t.channel === "alert" ? "alert" : ""} style={{ width: `${(t.count / topMax) * 100}%` }} /></div>
              <b>{t.count}</b>
            </div>
          ))}
        </section>
      </div>

      <section className="card panel">
        <div className="section-title"><h2>Señal Wi‑Fi (RSSI)</h2><span className="mono">promedio por hora · dBm</span></div>
        <RssiChart data={stats?.rssi ?? []} />
      </section>

      <section className="card panel">
        <div className="section-title"><h2>Registro</h2><span className="mono">{rows ? `${rows.total} resultados` : ""}</span></div>
        <div className="tablewrap">
          <table>
            <thead><tr><th>Fecha</th><th>Evento</th><th>Detalle</th><th>Canal</th></tr></thead>
            <tbody>
              {rows?.items.map((r) => (
                <tr key={r._id}>
                  <td className="mono">{fmt(r.ts)}</td>
                  <td>{title(r.type)}</td>
                  <td className="muted">{r.detail || "—"}</td>
                  <td><span className={`tag ${r.channel}`}>{r.channel === "alert" ? "alerta" : "evento"}</span></td>
                </tr>
              ))}
              {rows && rows.items.length === 0 && <tr><td colSpan={4} className="empty">No hay registros con estos filtros.</td></tr>}
              {!rows && !error && <tr><td colSpan={4} className="empty">{loading ? "Cargando…" : ""}</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="pager">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Anterior</button>
          <span className="mono">Página {page} de {pages}</span>
          <button disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Siguiente →</button>
        </div>
      </section>
    </main>
  );
}
