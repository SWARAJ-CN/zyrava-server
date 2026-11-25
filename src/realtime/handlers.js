import { conversationPeers } from "../services/communityService.js";
import { emitToUsers } from "./rooms.js";

/**
 * The only traffic that genuinely belongs on the socket: typing. It is
 * ephemeral, fires many times a second, and nobody wants it in a database or
 * behind a CSRF token. Everything that must survive a dropped connection
 * (messages, requests, read state) is written over REST — see
 * `routes/communityRoutes.js`.
 */

/** One keystroke report per second and a half is plenty to light a dot. */
const TYPING_MIN_MS = 1_500;

const asId = (value) => String(value ?? "");

/** ObjectId-shaped only, so a stray payload never reaches a Mongo query. */
const HEX24 = /^[a-f\d]{24}$/i;

export function registerRealtimeHandlers(io) {
  io.on("connection", (socket) => {
    const userId = socket.data.userId;
    let lastTypingAt = 0;
    let lastStopAt = 0;

    async function typing(payload, isTyping) {
      const conversationId = asId(payload?.conversationId);
      if (!HEX24.test(conversationId)) return;

      const now = Date.now();
      if (isTyping) {
        if (now - lastTypingAt < TYPING_MIN_MS) return;
        lastTypingAt = now;
      } else {
        if (now - lastStopAt < 250) return;
        lastStopAt = now;
      }
      // A block can change mid-session: never retain permanent authorization
      // in a socket cache. Throttle before checking membership and block state.
      const peerIds = await conversationPeers(conversationId, userId);
      if (!peerIds.length) return;

      emitToUsers(peerIds, "typing", { conversationId, userId, isTyping });
    }

    const forward = (isTyping) => (payload) => {
      typing(payload, isTyping).catch(() => {
        /* not a member of that thread — nothing to announce */
      });
    };

    socket.on("typing:start", forward(true));
    socket.on("typing:stop", forward(false));
  });
}
