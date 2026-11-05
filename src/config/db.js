import mongoose from "mongoose";
import { env } from "./env.js";
import { User } from "../models/User.js";
import { Session } from "../models/Session.js";
import { LikedSong } from "../models/LikedSong.js";
import { Playlist } from "../models/Playlist.js";
import { HistoryEvent } from "../models/historyEvent.js";
import { KnownSong } from "../models/knownSong.js";
import { ChatRequest } from "../models/ChatRequest.js";
import { Conversation } from "../models/Conversation.js";
import { Message } from "../models/Message.js";
import { AppError } from "../utils/http.js";

/**
 * One pooled connection for the whole process. Render's free instance is
 * small, so the pool stays deliberately modest: enough concurrency for the
 * auth endpoints without holding Atlas connections open.
 *
 * Index creation belongs to boot, but a restricted Atlas user or a
 * disk-constrained box can defer it: set MONGO_INDEXES=off and build the
 * indexes once from a privileged client. The schemas still declare them.
 */
const manageIndexes = process.env.MONGO_INDEXES !== "off";

export async function connectDb() {
  mongoose.set("strictQuery", true);
  mongoose.set("sanitizeFilter", true);

  await mongoose.connect(env.mongoUri, {
    maxPoolSize: 10,
    minPoolSize: 1,
    maxIdleTimeMS: 30_000,
    serverSelectionTimeoutMS: 8_000,
    socketTimeoutMS: 45_000,
    autoIndex: manageIndexes,
  });

  // Unique + TTL indexes are part of the contract, not an afterthought.
  if (manageIndexes) {
    await Promise.all([
      User.init(),
      Session.init(),
      LikedSong.init(),
      Playlist.init(),
      HistoryEvent.init(),
      KnownSong.init(),
      ChatRequest.init(),
      Conversation.init(),
      Message.init(),
    ]);
  }
  return mongoose.connection;
}

export function dbStatus() {
  return mongoose.connection.readyState === 1 ? "up" : "down";
}

/** The raw driver handle used by the read-only admin aggregations. */
export function database() {
  const db = mongoose.connection.db;
  if (!db || dbStatus() !== "up") {
    throw new AppError(503, "The database is not connected yet.");
  }
  return db;
}

export async function disconnectDb() {
  await mongoose.disconnect();
}
