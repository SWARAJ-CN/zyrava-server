import { adminEnv } from "../env.js";
import { dbStatus, database } from "../../config/db.js";
import { cacheInfo } from "../lib/cache.js";
import { COLLECTIONS } from "../lib/collections.js";

const KNOWN = new Set(Object.values(COLLECTIONS));

export async function getSystem() {
  const db = database();
  const started = Date.now();
  await db.command({ ping: 1 });
  const latencyMs = Date.now() - started;

  const collectionRows = await db.listCollections({}, { nameOnly: true }).toArray();

  const collections = await Promise.all(
    collectionRows
      .filter((row) => !row.name.startsWith("system."))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(async (row) => ({
        name: row.name,
        documents: await db.collection(row.name).estimatedDocumentCount().catch(() => null),
        known: KNOWN.has(row.name),
      }))
  );

  const memory = process.memoryUsage();

  return {
    generatedAt: new Date(),
    admin: { email: adminEnv.email },
    config: {
      environment: process.env.NODE_ENV === "production" ? "production" : "development",
      allowDelete: adminEnv.allowDelete,
      cacheTtlMs: adminEnv.cacheTtlMs,
      adminSessionHours: adminEnv.sessionHours,
      apiUrl: adminEnv.apiUrl,
      node: process.version,
    },
    database: {
      status: dbStatus(),
      name: db.databaseName,
      latencyMs,
      collections,
    },
    process: {
      uptimeSeconds: Math.round(process.uptime()),
      heapUsedMb: Math.round(memory.heapUsed / 1024 / 1024),
      rssMb: Math.round(memory.rss / 1024 / 1024),
    },
    cache: cacheInfo(),
  };
}
