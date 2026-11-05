/**
 * Room naming and the fan-out helpers every push goes through.
 *
 * There is only one room kind: a user's own. Every socket of an account joins
 * `user:<id>` on connect, so a message, a request or a presence change reaches
 * all of that person's tabs without the client having to subscribe per thread.
 * A 1:1 app does not need conversation rooms, and skipping them removes the
 * race where a tab receives an event before it has joined the room.
 */
let ioRef = null;

export function setIo(io) {
  ioRef = io;
}

export function getIo() {
  return ioRef;
}

export function userRoom(userId) {
  return `user:${userId}`;
}

/** Reach every live tab of these accounts. No-op while realtime is absent. */
export function emitToUsers(userIds, event, payload) {
  const io = getIo();
  if (!io || !userIds?.length) return;
  io.to(userIds.map(userRoom)).emit(event, payload);
}

/** Reach every live tab of one account only. */
export function emitToUser(userId, event, payload) {
  const io = getIo();
  if (!io || !userId) return;
  io.to(userRoom(userId)).emit(event, payload);
}

/**
 * Reach every live tab in the room. Presence is the one event sent globally:
 * the people list shows listeners you have never messaged, so an online dot
 * cannot wait for a thread to exist. Three short fields, once per sign-in and
 * once per last-tab-closed — a rounding error next to the traffic it replaces.
 */
export function broadcastAll(event, payload) {
  const io = getIo();
  if (!io) return;
  io.emit(event, payload);
}
