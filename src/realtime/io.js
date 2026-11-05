import { Server } from "socket.io";
import { env } from "../config/env.js";
import { verifyAccessToken } from "../utils/tokens.js";
import { markSeen } from "../services/communityService.js";
import { addSocket, removeSocket } from "./presence.js";
import { setIo, userRoom } from "./rooms.js";
import { presenceChanged, presenceSnapshot } from "./emit.js";
import { registerRealtimeHandlers } from "./handlers.js";

/**
 * Socket.IO rides the same HTTP server as the REST API, so the deployment keeps
 * one port, one process and one shutdown path — Render never learns that a
 * websocket exists.
 */

function originAllowed(origin) {
  if (!origin) return true;
  return env.clientOrigins.includes(origin.replace(/\/$/, ""));
}

export function attachRealtime(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => {
        if (!originAllowed(origin)) return callback(new Error("Origin not allowed."));
        return callback(null, true);
      },
      credentials: true,
    },
    // The SPA bundles its own socket.io-client, so no second copy is served.
    serveClient: false,
    // Comfortably inside Render's ~100 s idle cut, so a quiet thread stays up.
    pingInterval: 25_000,
    pingTimeout: 20_000,
    // Message length is enforced in REST; this only bounds the handshake.
    maxHttpBufferSize: 64 * 1024,
  });

  setIo(io);

  /*
   * The access token lives in the SPA's memory only, so it arrives in the
   * handshake rather than a cookie — the same token the REST layer accepts,
   * which means signing out or letting it expire also ends the socket.
   */
  io.use((socket, next) => {
    const token = String(socket.handshake.auth?.token ?? "");
    try {
      socket.data.userId = verifyAccessToken(token).sub;
    } catch {
      return next(new Error("Unauthorized"));
    }
    return next();
  });

  io.on("connection", (socket) => {
    const userId = socket.data.userId;
    socket.join(userRoom(userId));

    presenceSnapshot(socket);

    // A second tab opening is not the person coming online; only the first is.
    if (addSocket(userId, socket.id)) {
      void announce(userId, new Date());
    }

    socket.on("disconnect", () => {
      // The last tab closing is what "went offline" means for a listener.
      if (removeSocket(userId, socket.id)) void announce(userId, new Date());
    });
  });

  registerRealtimeHandlers(io);

  return io;
}

/** Stamp the profile and tell the threads that care. Best-effort by design. */
async function announce(userId, lastSeenAt) {
  try {
    await markSeen(userId);
    await presenceChanged(userId, lastSeenAt);
  } catch {
    /* presence may be missed; a thread must never fail because of it */
  }
}
