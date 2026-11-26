import mongoose from "mongoose";
import { config } from "../config";

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
