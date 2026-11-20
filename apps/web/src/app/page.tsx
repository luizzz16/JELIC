"use client";
import { useEffect, useMemo, useState } from "react";
import type { LockCommand } from "@jelic/shared";
import { useLock, type Link, type LogItem } from "../lib/useLock";

/* ---------- textos y clasificación de eventos del firmware ---------- */

type Tone = "ok" | "warn" | "bad" | "info" | "idle";
const EVENT_TEXT: Record<string, { title: string; tone: Tone }> = {
  presence_detected: { title: "Persona detectada en el exterior", tone: "info" },
  presence_cleared: { title: "Ya no hay presencia", tone: "idle" },
  door_open: { title: "Puerta abierta", tone: "warn" },
  door_closed: { title: "Puerta cerrada", tone: "ok" },
  vibration: { title: "Golpe fuerte en la puerta", tone: "warn" },
  door_forced: { title: "Puerta forzada", tone: "bad" },
  tamper_vibration: { title: "Forcejeo en la puerta", tone: "bad" },
  lock_rejected: { title: "Cierre rechazado: puerta abierta", tone: "warn" },
  alarm_test: { title: "Prueba de alarma", tone: "info" },
  alarm_silenced: { title: "Alarma silenciada", tone: "idle" },
  latch_locking: { title: "Cerrando…", tone: "idle" },
  latch_unlocking: { title: "Abriendo…", tone: "idle" },
  latch_confirmed: { title: "Movimiento confirmado", tone: "ok" },
  device_online: { title: "Dispositivo conectado", tone: "ok" },
  cmd_rejected: { title: "Comando rechazado", tone: "warn" },
};

const KIND: Record<Tone, "secure" | "open" | "alert" | ""> = { ok: "secure", warn: "open", bad: "alert", info: "", idle: "" };
const LOCK_EVENTS = new Set(["latch_locking", "latch_unlocking", "latch_confirmed", "lock_rejected", "cmd_rejected"]);
/** Firmware answers a LOCK/UNLOCK with one of these once the servo finished (or refused). */
const DONE = new Set(["latch_confirmed", "lock_rejected", "cmd_rejected"]);
const MOVE_TIMEOUT_MS = 5000;

type AlertKey = "forcejeo" | "presencia" | "puerta";
const ALERT_OF: Record<string, AlertKey> = {
  tamper_vibration: "forcejeo",
  door_forced: "forcejeo",
  vibration: "forcejeo",
  presence_detected: "presencia",
  door_open: "puerta",
};

const describe = (i: LogItem) => EVENT_TEXT[i.type] ?? { title: i.type, tone: (i.channel === "alert" ? "bad" : "info") as Tone };

/* ---------- utilidades ---------- */

const ago = (t: number, now: number) => {
  const s = Math.max(0, Math.round((now - t) / 1000));
  return s < 10 ? "ahora" : s < 60 ? `hace ${s} s` : s < 3600 ? `hace ${Math.floor(s / 60)} min` : `hace ${Math.floor(s / 3600)} h`;
};
const clock = (t: number) => new Date(t).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", hour12: false });

const LINK: Record<Link, { label: string; cls: string }> = {
  connecting: { label: "Conectando…", cls: "wait" },
  live: { label: "En vivo", cls: "" },
  "broker-down": { label: "Broker caído", cls: "off" },
  offline: { label: "Sin servidor", cls: "off" },
};

const svgProps = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const IconCalm = () => (<svg {...svgProps}><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /><path d="M9 12l2 2 4-4" /></svg>);
const IconUser = () => (<svg {...svgProps}><circle cx="12" cy="7" r="4" /><path d="M5 21a7 7 0 0 1 14 0" /></svg>);
const IconAlert = () => (<svg {...svgProps}><path d="M12 3l10 18H2z" /><path d="M12 10v5M12 18v.01" /></svg>);
const IconWave = () => (<svg {...svgProps}><path d="M2 12h3l2-5 4 10 3-8 2 3h6" /></svg>);
const IconDoor = () => (<svg {...svgProps}><path d="M5 21V4a1 1 0 0 1 1-1h9l4 2v16" /><path d="M3 21h18" /><circle cx="12" cy="12" r=".6" fill="currentColor" /></svg>);

const ALERT_ROWS: { key: AlertKey; title: string; cls: string; icon: React.ReactNode }[] = [
  { key: "forcejeo", title: "Forcejeo", cls: "hot", icon: <IconWave /> },
  { key: "presencia", title: "Presencia exterior", cls: "pres", icon: <IconUser /> },
  { key: "puerta", title: "Puerta abierta", cls: "door", icon: <IconDoor /> },
];

const HOUR = 3600e3;
const FIVE_MIN = 300e3;

/* ---------- página ---------- */

export default function Page() {
  const { status, online, link, log, sendCommand } = useLock();
  const [now, setNow] = useState(() => Date.now());
  const [filter, setFilter] = useState<"all" | "alert" | "lock">("all");
  const [showAll, setShowAll] = useState(false);
  const [acked, setAcked] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);

  const canSend = link === "live" && online;
  const hasStatus = !!status;
  const locked = status?.latch === "locked";

  /* pestillo en movimiento: espera confirmación del dispositivo, con timeout */
  const doneCount = log.filter((l) => DONE.has(l.type)).length;
  const [pending, setPending] = useState<{ action: LockCommand; done: number } | null>(null);
  const moving = pending && doneCount === pending.done ? pending.action : null;
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => setPending(null), MOVE_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [pending]);
  const move = (action: "LOCK" | "UNLOCK") => {
    if (sendCommand(action)) setPending({ action, done: doneCount });
  };

  /* alertas agrupadas por tipo (última hora) */
  const alertTimes = useMemo(() => {
    const a: Record<AlertKey, number[]> = { forcejeo: [], presencia: [], puerta: [] };
    for (const e of [...log].reverse()) {
      const k = ALERT_OF[e.type];
      if (k) a[k].push(e.ts);
    }
    return a;
  }, [log]);
  const recent = (k: AlertKey) => alertTimes[k].filter((t) => now - t < HOUR);
  const fresh = (k: AlertKey, ms: number) => alertTimes[k].some((t) => now - t < ms && t > acked);
  const last = (k: AlertKey) => alertTimes[k][alertTimes[k].length - 1];

  /* estado global de seguridad: una sola lectura clara */
  let sec: { cls: "" | "warn" | "alert"; icon: React.ReactNode; title: string; text: string } = {
    cls: "", icon: <IconCalm />, title: "Todo en calma", text: "Sin eventos sospechosos",
  };
  const alarmOn = !!status?.alarm;
  if (alarmOn || fresh("forcejeo", 120e3)) {
    sec = {
      cls: "alert", icon: <IconAlert />,
      title: alarmOn && !fresh("forcejeo", 120e3) ? "Alarma activa" : "Forcejeo detectado",
      text: last("forcejeo") ? `${ago(last("forcejeo"), now)}. La alarma puede estar sonando.` : "La alarma puede estar sonando.",
    };
  } else if (status?.presence || fresh("presencia", 60e3)) {
    sec = { cls: "warn", icon: <IconUser />, title: "Alguien en la puerta", text: last("presencia") ? ago(last("presencia"), now) : "Hay alguien frente a la puerta" };
  } else if (status?.door === "open" && fresh("puerta", 60e3)) {
    sec = { cls: "warn", icon: <IconWave />, title: "Puerta abierta", text: "Revisa si es esperado" };
  } else if (recent("forcejeo").length) {
    sec.text = `Último forcejeo ${ago(last("forcejeo"), now)} · atendido`;
  }

  /* lista de actividad: filtrada y con repetidos consecutivos agrupados ("×4") */
  const groups = useMemo(() => {
    const items = log
      .map((i) => ({ i, d: describe(i) }))
      .filter(({ i, d }) => filter === "all" || (filter === "alert" ? i.channel === "alert" || d.tone === "bad" : LOCK_EVENTS.has(i.type)));
    const g: { id: string; title: string; kind: string; n: number; ts: number }[] = [];
    for (const { i, d } of items) {
      const p = g[g.length - 1];
      if (p && p.title === d.title && p.ts - i.ts < FIVE_MIN) p.n++;
      else g.push({ id: i.id, title: d.title, kind: KIND[d.tone], n: 1, ts: i.ts });
    }
    return g;
  }, [log, filter]);
  const visible = showAll ? groups : groups.slice(0, 5);

  const rssi = status?.rssi ?? 0;
  const bars = !online ? 0 : rssi > -55 ? 4 : rssi > -65 ? 3 : rssi > -75 ? 2 : 1;
  const signal = !online ? "Sin señal" : ["", "Débil", "Regular", "Buena", "Excelente"][bars];

  const word = !hasStatus ? "Sin datos" : locked ? "Cerrado" : "Abierto";
  const sub = !online
    ? "Dispositivo sin conexión"
    : moving ? "Moviendo el seguro…" : locked ? "La puerta está asegurada" : "La puerta no tiene seguro";
  const stateColor = !hasStatus ? "var(--muted)" : alarmOn ? "var(--alert)" : locked ? "var(--secure)" : "var(--open)";
  const lk = LINK[link];

  return (
    <main className={`app ${locked ? "locked" : "unlocked"}`} style={{ ["--state" as string]: stateColor }}>
      <header>
        <div className="brand">
          Jelic <span>Puerta principal</span>
        </div>
        <div className={`chip ${lk.cls}`}><i /><span>{lk.label}</span></div>
      </header>

      <section className="card hero">
        <div className="mono">Puerta</div>
        <h1>{word}</h1>
        <p>{sub}</p>

        <button
          type="button"
          className="plan"
          disabled={!canSend || !!moving || !hasStatus}
          onClick={() => move(locked ? "UNLOCK" : "LOCK")}
          aria-label={locked ? "Abrir la puerta" : "Cerrar la puerta"}
        >
          <svg viewBox="0 0 320 120">
            <rect className="stroke" x="216" y="22" width="100" height="76" fill="rgba(255,255,255,.03)" />
            <rect className="stroke" x="216" y="48" width="32" height="24" fill="#0A0D11" />
            <rect className="stroke" x="8" y="22" width="202" height="76" fill="#11161C" />
            <rect className="stroke" x="150" y="48" width="60" height="24" fill="#0A0D11" />
            <rect id="bolt" x="172" y="53" width="68" height="14" rx="3" />
            <circle className="stroke" cx="62" cy="60" r="24" />
            <circle className="stroke" cx="62" cy="60" r="16" strokeDasharray="2 3" />
            <g id="knob"><line x1="62" y1="60" x2="62" y2="40" stroke="var(--text)" strokeWidth="3" strokeLinecap="round" /></g>
            <circle cx="62" cy="60" r="4" fill="var(--text)" />
            <rect x="199" y="24" width="8" height="4" rx="1" fill="var(--muted)" />
            <rect x="219" y="24" width="8" height="4" rx="1" fill="var(--muted)" />
            <text x="10" y="15">Puerta</text><text x="218" y="15">Marco</text>
            <text x="10" y="112">Perilla</text><text x="218" y="112">Seguro</text>
          </svg>
        </button>
        <div className="hint">
          {moving ? "Un momento…" : canSend && hasStatus ? (locked ? "Toca la puerta para abrirla" : "Toca la puerta para cerrarla") : "Control no disponible por ahora"}
        </div>
      </section>

      <div className="section-title"><h2>Seguridad</h2><span className="mono">Última hora</span></div>
      <section className={`card status ${sec.cls}`}>
        <div className="badge">{sec.icon}</div>
        <div><b>{sec.title}</b><small>{sec.text}</small></div>
        {alarmOn && (
          <button
            disabled={!canSend}
            onClick={() => { if (sendCommand("SILENCE")) setAcked(Date.now()); }}
          >
            Silenciar
          </button>
        )}
      </section>

      <div className="alerts">
        {ALERT_ROWS.map((r) => {
          const arr = recent(r.key);
          return (
            <div key={r.key} className={`arow ${r.cls}`}>
              <div className="ic">{r.icon}</div>
              <div><b>{r.title}</b><small>{arr.length ? `Última ${ago(arr[arr.length - 1], now)}` : "Sin registros"}</small></div>
              <div className="right">
                <div className="n">{arr.length}</div>
                <div className="spark">
                  {Array.from({ length: 12 }, (_, i) => {
                    const from = now - (12 - i) * FIVE_MIN, to = from + FIVE_MIN;
                    const c = arr.filter((t) => t >= from && t < to).length;
                    return <i key={i} className={c ? "on" : ""} style={c ? { height: Math.min(14, 5 + c * 3) } : undefined} />;
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="tiles">
        <div className="tile"><span className="mono">Puerta</span><div className="v">{status ? (status.door === "open" ? "Abierta" : "Cerrada") : "—"}</div></div>
        <div className="tile">
          <span className="mono">Conexión</span>
          <div className="v">
            {status ? <>{signal}<span className="bars">{[0, 1, 2, 3].map((n) => <b key={n} className={n < bars ? "on" : ""} />)}</span></> : "—"}
          </div>
        </div>
        <div className="tile"><span className="mono">Respaldo</span><div className="v">{status ? (status.sd ? "Activo" : "Inactivo") : "—"}</div></div>
      </div>

      <section className="log">
        <div className="section-title">
          <h2>Actividad</h2>
          <div className="filters">
            {([["all", "Todo"], ["alert", "Alertas"], ["lock", "Cerradura"]] as const).map(([f, label]) => (
              <button key={f} className={filter === f ? "on" : ""} onClick={() => { setFilter(f); setShowAll(false); }}>{label}</button>
            ))}
          </div>
        </div>
        <ul className="events">
          {visible.length === 0 ? (
            <li className="empty">Esperando eventos del dispositivo…</li>
          ) : (
            visible.map((e) => (
              <li key={e.id} className={e.kind}>
                <span>{e.title}{e.n > 1 && <span className="x">×{e.n}</span>}</span>
                <time>{clock(e.ts)}</time>
              </li>
            ))
          )}
        </ul>
        {groups.length > 5 && (
          <button className="more" onClick={() => setShowAll((v) => !v)}>{showAll ? "Ver menos" : `Ver todo (${groups.length})`}</button>
        )}
      </section>
    </main>
  );
}
