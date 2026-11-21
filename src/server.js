import { createServer } from "node:http";
import { app } from "./app.js";
import { env } from "./config/env.js";
import { connectDb, disconnectDb } from "./config/db.js";
import { attachRealtime } from "./realtime/io.js";


import { prepareEmailAuthentication } from "./services/emailAuthRollout.js";
import { startAdminAuthEmailWorker } from "./services/adminAuthEmailService.js";

async function start() {
  await connectDb();
  await prepareEmailAuthentication();

  // One HTTP server for both halves of the app: the REST API and, riding on
  // the same port, the Socket.IO endpoint the community live-updates.
  const server = createServer(app);
  const io = attachRealtime(server);
  const stopAdminAuthEmails = startAdminAuthEmailWorker();

  server.listen(env.port, () => {
    console.log(`[zyrava] API listening on :${env.port} (${env.isProd ? "production" : "development"})`);
  });

  // Keep idle keep-alive sockets shorter than the platform's proxy timeout.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  const shutdown = async (signal) => {
    stopAdminAuthEmails();
    console.log(`[zyrava] ${signal} received — draining`);
    server.close(async () => {
      // Last, so the websocket only goes away once HTTP has stopped accepting.
      io.close();
      await disconnectDb();
      process.exit(0);
    });
    // Do not hang Render's 30 s kill window.
    setTimeout(() => process.exit(1), 20_000).unref();
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("unhandledRejection", (reason) => {
    console.error("[zyrava] unhandled rejection:", reason);
  });
  process.on("uncaughtException", (error) => {
    console.error("[zyrava] uncaught exception:", error);
    void shutdown("uncaughtException");
  });
}

start().catch((error) => {
  console.error("[zyrava] failed to start:", error);
  process.exit(1);
});
