import dns from "node:dns";
import mongoose from "mongoose";
import { config } from "../config";

// En algunos Windows Node no lee el DNS del sistema y queda en 127.0.0.1: falla la consulta SRV de mongodb+srv.
if (dns.getServers().every((s) => s === "127.0.0.1" || s === "::1")) dns.setServers(["8.8.8.8", "1.1.1.1"]);

/** Conecta a MongoDB Atlas. Si no hay MONGODB_URI, el sistema sigue funcionando sin persistencia. */
export async function connectDb(): Promise<boolean> {
  if (!config.mongoUri) {
    console.warn("[db] MONGODB_URI no definido: el historial NO se guardará.");
    return false;
  }
  try {
    await mongoose.connect(config.mongoUri, { dbName: config.mongoDb, serverSelectionTimeoutMS: 8000 });
    console.log(`[db] conectado a MongoDB (${config.mongoDb})`);
    return true;
  } catch (e) {
    console.error("[db] error de conexión:", (e as Error).message);
    return false;
  }
}

export const dbReady = () => mongoose.connection.readyState === 1;
export const closeDb = () => mongoose.disconnect();
