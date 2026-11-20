function required(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    console.error(`[config] Missing ${name}. Copy apps/web/.env.example to apps/web/.env and fill it in.`);
    process.exit(1);
  }
  return v;
}

const base = `smartlock/${required("DEVICE_ID")}`;

export const config = {
  mqttUrl: required("MQTT_URL"),
  mqttUsername: process.env.MQTT_USERNAME || undefined,
  mqttPassword: process.env.MQTT_PASSWORD || undefined,
  base,
  port: Number(process.env.PORT ?? 3000),
  historyLimit: 200,
};

/** Same topics as the ESP32 firmware. */
export const topics = {
  status: `${base}/status`, // retained JSON
  event: `${base}/event`,
  alert: `${base}/alert`,
  online: `${base}/online`, // retained, LWT: online | offline
  command: `${base}/cmd`, // web -> ESP32
};
