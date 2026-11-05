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

/** A stop is never dropped, so it bypasses the throttle. */
const CONVERSATIONS_PER_SOCKET = 50;

const asId = (value) => String(value ?? "");

/** ObjectId-shaped only, so a stray payload never reaches a Mongo query. */
const HEX24 = /^[a-f\d]{24}$/i;

export function registerRealtimeHandlers(io) {
  io.on("connection", (socket) => {
    const userId = socket.data.userId;
    // conversation id -> the peer it belongs to. Membership is permanent for a
    // 1:1 thread, so a socket may cache it once instead of re-querying Mongo on
    // every keystroke.
    const peers = new Map();
    let lastTypingAt = 0;

    async function typing(payload, isTyping) {
      const conversationId = asId(payload?.conversationId);
      if (!HEX24.test(conversationId)) return;

      let peerIds = peers.get(conversationId);
      if (peerIds === undefined) {
        if (peers.size >= CONVERSATIONS_PER_SOCKET) peers.clear();
        // Throws for a stranger or a deleted thread; the catch below swallows it
        // so a forged id costs nothing but an ignored event.
        peerIds = await conversationPeers(conversationId, userId);
        peers.set(conversationId, peerIds);
      }
      if (!peerIds.length) return;

      if (isTyping) {
        const now = Date.now();
        if (now - lastTypingAt < TYPING_MIN_MS) return;
        lastTypingAt = now;
      }

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
