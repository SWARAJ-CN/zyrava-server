/**
 * In-memory presence for the single API instance this deployment runs.
 *
 * A user can have several tabs/devices open, so the map stores the set of
 * socket ids rather than a boolean. If the service is ever scaled across
 * instances this needs a shared adapter (Redis) — the shape stays the same.
 */
const connections = new Map();

export function addSocket(userId, socketId) {
  const id = String(userId);
  const sockets = connections.get(id) ?? new Set();
  const firstConnection = sockets.size === 0;
  sockets.add(socketId);
  connections.set(id, sockets);
  return firstConnection;
}

export function removeSocket(userId, socketId) {
  const id = String(userId);
  const sockets = connections.get(id);
  if (!sockets) return false;
  sockets.delete(socketId);
  if (sockets.size) return false;
  connections.delete(id);
  return true;
}

export function isOnline(userId) {
  return connections.has(String(userId));
}

export function onlineUserIds() {
  return [...connections.keys()];
}

export function onlineCount() {
  return connections.size;
}
