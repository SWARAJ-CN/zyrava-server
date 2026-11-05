import { broadcastAll, emitToUser, emitToUsers } from "./rooms.js";
import {
  conversationSummaryFor,
  personView,
} from "../services/communityService.js";
import { isOnline, onlineUserIds } from "./presence.js";

const asId = (value) => String(value ?? "");

/**
 * The named pushes the REST controllers fire after a successful write, so a
 * route never has to know about rooms or socket ids — and a failed emit can
 * never turn a saved message into a failed request.
 *
 * Every payload is built per viewer rather than shared: `person()` and the
 * `mine` flag are both point-of-view facts, and sending the sender's version to
 * the receiver would label the wrong messages as theirs.
 */

/** What is already online when this tab opens, so the lists start truthful. */
export function presenceSnapshot(socket) {
  socket.emit("presence:init", { online: onlineUserIds() });
}

/** Tell the room that a listener came or went. */
export function presenceChanged(userId, lastSeenAt) {
  broadcastAll("presence:update", {
    userId: asId(userId),
    online: isOnline(userId),
    lastSeenAt: lastSeenAt ? new Date(lastSeenAt).toISOString() : null,
  });
}

/** The request as its target reads it: incoming, and showing the sender. */
export async function requestReceived(targetId, request, senderId) {
  const sender = await personView(senderId);
  if (!sender) return;
  emitToUser(targetId, "request:received", {
    request: {
      id: asId(request?._id ?? request?.id),
      direction: "incoming",
      status: "pending",
      createdAt: request?.createdAt,
      user: sender,
    },
  });
}

export function requestResolved(targetId, requestId, accepted) {
  emitToUser(targetId, "request:resolved", {
    requestId: asId(requestId),
    status: accepted ? "accepted" : "declined",
  });
}

/** Each side of a brand-new thread gets its own view of it. */
export async function conversationOpened(memberIds, conversationId) {
  for (const memberId of memberIds) {
    const conversation = await conversationSummaryFor(memberId, conversationId);
    if (conversation) emitToUser(memberId, "conversation:new", { conversation });
  }
}

export async function messageDelivered(senderId, memberIds, message) {
  for (const memberId of memberIds) {
    emitToUser(memberId, "message:new", {
      message: { ...message, mine: asId(memberId) === asId(senderId) },
    });
  }
}

export async function conversationUpdated(memberIds, conversationId) {
  for (const memberId of memberIds) {
    const conversation = await conversationSummaryFor(memberId, conversationId);
    if (conversation) emitToUser(memberId, "conversation:update", { conversation });
  }
}

export function conversationRead(memberIds, conversationId, readerId) {
  emitToUsers(memberIds, "conversation:read", {
    conversationId: asId(conversationId),
    readerId: asId(readerId),
  });
}
