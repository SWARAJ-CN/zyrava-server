import mongoose from "mongoose";
import { claimUpload } from "./mediaService.js";
import { MediaUpload } from "../models/MediaUpload.js";
import { randomUUID } from "node:crypto";
import { ChatRequest } from "../models/ChatRequest.js";
import { Conversation } from "../models/Conversation.js";
import { Message } from "../models/Message.js";
import { User } from "../models/User.js";
import { AppError } from "../utils/http.js";
import { isOnline, onlineCount } from "../realtime/presence.js";
import { communityUserFilter, hiddenCommunityIds } from "./accountExperience.js";

const MAX_MESSAGE = 2000;
const MAX_PAGE = 40;

function asId(value) {
  return String(value);
}

/** A stable key for a two-person thread, independent of who asked first. */
function pairKey(a, b) {
  return [asId(a), asId(b)].sort().join(":");
}

function person(user) {
  return {
    id: asId(user._id ?? user.id),
    name: user.name?.trim() || "Music lover",
    avatarUrl: user.avatar?.url ?? null,
    lastSeenAt: user.lastSeenAt ?? null,
    online: isOnline(user._id ?? user.id),
  };
}

function requestItem(request, user, direction) {
  return {
    id: asId(request._id),
    direction,
    status: request.status,
    createdAt: request.createdAt,
    user: person(user),
  };
}

export function replyView(message) {
  if (!message) return null;
  return { id: asId(message._id), from: asId(message.from), text: message.deletedAt ? "" : message.text,
    kind: message.deletedAt ? null : message.attachment?.kind ?? null, deleted: !!message.deletedAt };
}

export function assertChatWritable(conversation) {
  if (conversation.blockedBy?.length) throw new AppError(403, "Messaging is unavailable in this conversation.");
}

function messageItem(message, viewerId, reply = null) {
  return {
    id: asId(message._id),
    conversationId: asId(message.conversation),
    from: asId(message.from),
    text: message.deletedAt ? "" : message.text,
    attachment: message.deletedAt ? null : message.attachment ?? null,
    reply: message.deletedAt ? null : reply,
    editedAt: message.editedAt ?? null,
    deleted: !!message.deletedAt,
    revision: message.revision ?? 0,
    reactions: message.deletedAt ? [] : Object.entries(message.reactions instanceof Map ? Object.fromEntries(message.reactions) : message.reactions ?? {}).map(([userId, emoji]) => ({ userId, emoji })),
    clientId: message.clientId ?? "",
    createdAt: message.createdAt,
    mine: asId(message.from) === asId(viewerId),
    seen: (message.readBy ?? []).some((reader) => asId(reader) !== asId(message.from)),
  };
}

async function usersByIds(ids) {
  if (!ids.length) return new Map();
  // The connection sanitizes filters, so an operator here is declared trusted.
  const rows = await User.find({ _id: mongoose.trusted({ $in: ids }), ...communityUserFilter() })
    .select("name lastSeenAt avatar")
    .lean();
  return new Map(rows.map((row) => [asId(row._id), row]));
}

async function ensureConversation(first, second) {
  const members = [asId(first), asId(second)].sort().map((id) => new mongoose.Types.ObjectId(id));
  return Conversation.findOneAndUpdate(
    { pairKey: pairKey(first, second) },
    { $setOnInsert: { members, lastMessageAt: new Date() } },
    { new: true, upsert: true }
  );
}

async function conversationMembers(conversationId) {
  const conversation = await Conversation.findById(conversationId).lean();
  if (!conversation) throw new AppError(404, "That conversation no longer exists.");
  return conversation;
}

async function assertMember(conversation, userId) {
  if (!conversation.members.map(asId).includes(asId(userId))) {
    throw new AppError(403, "This conversation is not yours.");
  }
  const visible = await usersByIds(conversation.members);
  if (visible.size !== conversation.members.length) {
    throw new AppError(404, "That conversation no longer exists.");
  }
}

async function conversationSummary(conversation, viewerId, otherUser, unread = 0, latest) {
  const last = latest === undefined ? await Message.findOne({ conversation: conversation._id, hiddenFor: mongoose.trusted({ $ne: viewerId }) }).sort({ createdAt: -1 }).lean() : latest;
  return {
    id: asId(conversation._id),
    user: person(otherUser),
    blockedByMe: (conversation.blockedBy ?? []).some(id => asId(id) === asId(viewerId)),
    messagingDisabled: !!conversation.blockedBy?.length,
    lastMessage: last ? { text: last.deletedAt ? "Message deleted" : last.text || ({ image: "Photo", video: "Video", audio: "Voice message" }[last.attachment?.kind] ?? "Attachment"), from: asId(last.from), at: last.createdAt } : null,
    unread,
    updatedAt: conversation.lastMessageAt ?? conversation.updatedAt,
    viewer: asId(viewerId),
  };
}

/** People you can ask to chat with, with the current relationship attached. */
export async function listPeople(viewerId, query = "") {
  // The connection sanitizes filters, so an operator here is declared trusted.
  const filter = { _id: mongoose.trusted({ $ne: viewerId }), ...communityUserFilter() };
  const trimmed = query.trim().slice(0, 80);
  if (trimmed) {
    const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(escaped, "i");
    filter.$or = [{ name: regex }, { email: regex }];
  }

  const users = await User.find(filter)
    .select("name lastSeenAt avatar")
    .sort({ lastSeenAt: -1, name: 1 })
    .limit(60)
    .lean();
  if (!users.length) return [];

  const ids = users.map((user) => asId(user._id));
  const [conversations, requests] = await Promise.all([
    Conversation.find({ members: viewerId }).select("members").lean(),
    ChatRequest.find({
      status: "pending",
      $or: [
        { from: viewerId, to: mongoose.trusted({ $in: ids }) },
        { to: viewerId, from: mongoose.trusted({ $in: ids }) },
      ],
    }).lean(),
  ]);

  const inConversation = new Set();
  for (const conversation of conversations) {
    for (const member of conversation.members) {
      if (asId(member) !== asId(viewerId)) inConversation.add(asId(member));
    }
  }

  const incoming = new Set();
  const outgoing = new Set();
  for (const request of requests) {
    if (asId(request.to) === asId(viewerId)) incoming.add(asId(request.from));
    else outgoing.add(asId(request.to));
  }

  return users
    .map((user) => {
      const id = asId(user._id);
      const relation = inConversation.has(id)
        ? "conversation"
        : incoming.has(id)
          ? "incoming"
          : outgoing.has(id)
            ? "outgoing"
            : "none";
      return { ...person(user), relation };
    })
    .sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
}

export async function listRequests(viewerId) {
  const [incomingRows, outgoingRows] = await Promise.all([
    ChatRequest.find({ to: viewerId, status: "pending" })
      .sort({ updatedAt: -1 })
      .limit(50)
      .lean(),
    ChatRequest.find({ from: viewerId, status: "pending" })
      .sort({ updatedAt: -1 })
      .limit(50)
      .lean(),
  ]);

  const ids = [
    ...incomingRows.map((request) => request.from),
    ...outgoingRows.map((request) => request.to),
  ];
  const users = await usersByIds(ids);

  return {
    incoming: incomingRows
      .filter((request) => users.has(asId(request.from)))
      .map((request) => requestItem(request, users.get(asId(request.from)), "incoming"))
      .filter((item) => item.user),
    outgoing: outgoingRows
      .filter((request) => users.has(asId(request.to)))
      .map((request) => requestItem(request, users.get(asId(request.to)), "outgoing"))
      .filter((item) => item.user),
  };
}

export async function sendRequest(viewerId, targetId) {
  if (asId(viewerId) === asId(targetId)) {
    throw new AppError(400, "You cannot send a chat request to yourself.");
  }
  const [target, viewer] = await Promise.all([
    User.findOne({ _id: targetId, ...communityUserFilter() }).select("name lastSeenAt avatar").lean(),
    User.findOne({ _id: viewerId, ...communityUserFilter() }).select("name lastSeenAt avatar").lean(),
  ]);
  if (!target || !viewer) throw new AppError(404, "That listener no longer exists.");

  const existingConversation = await Conversation.findOne({
    pairKey: pairKey(viewerId, targetId),
  }).lean();
  if (existingConversation) {
    assertChatWritable(existingConversation);
    return {
      status: "accepted",
      conversation: await conversationSummary(existingConversation, viewerId, target),
      to: person(target),
      from: person(viewer),
    };
  }

  // If they already asked us, asking back is consent — accept the pair at once.
  const reverse = await ChatRequest.findOne({
    from: targetId,
    to: viewerId,
    status: "pending",
  });
  if (reverse) {
    reverse.status = "accepted";
    reverse.respondedAt = new Date();
    await reverse.save();
    const conversation = await ensureConversation(viewerId, targetId);
    return {
      status: "accepted",
      conversation: await conversationSummary(conversation, viewerId, target),
      to: person(target),
      from: person(viewer),
    };
  }

  const forward = await ChatRequest.findOne({ from: viewerId, to: targetId });
  if (forward) {
    if (forward.status !== "pending") {
      forward.status = "pending";
      forward.respondedAt = null;
      await forward.save();
    }
    return {
      status: "pending",
      request: requestItem(forward, target, "outgoing"),
      to: person(target),
      from: person(viewer),
    };
  }

  const request = await ChatRequest.create({ from: viewerId, to: targetId });
  return {
    status: "pending",
    request: requestItem(request, target, "outgoing"),
    to: person(target),
    from: person(viewer),
  };
}

export async function respondRequest(viewerId, requestId, accept) {
  const request = await ChatRequest.findOne({ _id: requestId, to: viewerId, status: "pending" });
  if (!request) throw new AppError(404, "That request is no longer waiting.");

  const [viewer, requester] = await Promise.all([
    User.findOne({ _id: viewerId, ...communityUserFilter() }).select("name lastSeenAt avatar").lean(),
    User.findOne({ _id: request.from, ...communityUserFilter() }).select("name lastSeenAt avatar").lean(),
  ]);
  if (!viewer || !requester) throw new AppError(404, "That listener no longer exists.");

  request.status = accept ? "accepted" : "declined";
  request.respondedAt = new Date();
  await request.save();

  if (!accept) {
    return {
      status: "declined",
      conversation: null,
      from: asId(request.from),
      to: asId(viewerId),
      requester: person(requester),
      viewer: person(viewer),
    };
  }

  const conversation = await ensureConversation(viewerId, request.from);
  return {
    status: "accepted",
    conversation: await conversationSummary(conversation, viewerId, requester),
    forRequester: await conversationSummary(conversation, request.from, viewer),
    from: asId(request.from),
    to: asId(viewerId),
    requester: person(requester),
    viewer: person(viewer),
  };
}

export async function listConversations(viewerId) {
  const conversations = await Conversation.find({ members: viewerId })
    .sort({ lastMessageAt: -1 })
    .limit(60)
    .lean();
  if (!conversations.length) return [];

  const otherIds = conversations
    .map((conversation) =>
      conversation.members.map(asId).find((member) => member !== asId(viewerId))
    )
    .filter(Boolean);
  const users = await usersByIds(otherIds);

  const conversationIds = conversations.map((conversation) => conversation._id);
  const self = new mongoose.Types.ObjectId(asId(viewerId));
  const visibleRows = await Message.aggregate([
    { $match: { conversation: { $in: conversationIds }, hiddenFor: { $ne: self } } },
    { $sort: { createdAt: -1 } },
    { $group: { _id: "$conversation", latest: { $first: "$$ROOT" }, count: { $sum: { $cond: [
      { $and: [{ $ne: ["$from", self] }, { $not: [{ $in: [self, { $ifNull: ["$readBy", []] }] }] }, { $eq: [{ $ifNull: ["$deletedAt", null] }, null] }] }, 1, 0,
    ] } } } },
  ]);
  const visibleById = new Map(visibleRows.map(row => [asId(row._id), row]));

  const summaries = await Promise.all(
    conversations.map((conversation) => {
      const otherId = conversation.members.map(asId).find((member) => member !== asId(viewerId));
      const other = users.get(otherId);
      return other
        ? conversationSummary(conversation, viewerId, other, visibleById.get(asId(conversation._id))?.count ?? 0, visibleById.get(asId(conversation._id))?.latest ?? null)
        : null;
    })
  );
  return summaries.filter(Boolean);
}

export async function listMessages(viewerId, conversationId, before) {
  const conversation = await conversationMembers(conversationId);
  await assertMember(conversation, viewerId);

  const filter = { conversation: conversation._id, hiddenFor: mongoose.trusted({ $ne: viewerId }) };
  if (before) {
    const date = new Date(before);
    if (!Number.isNaN(date.getTime())) filter.createdAt = mongoose.trusted({ $lt: date });
  }

  const rows = await Message.find(filter)
    .sort({ createdAt: -1 })
    .limit(MAX_PAGE)
    .lean();

  const replyIds = rows.filter(row => row.replyTo).map(row => row.replyTo);
  const replies = replyIds.length ? await Message.find({ _id: mongoose.trusted({ $in: replyIds }), conversation: conversation._id, hiddenFor: mongoose.trusted({ $ne: viewerId }) }).lean() : [];
  const byId = new Map(replies.map(row => [asId(row._id), replyView(row)]));
  return rows.reverse().map(message => messageItem(message, viewerId, message.replyTo ? byId.get(asId(message.replyTo)) ?? { id: asId(message.replyTo), from: "", text: "", kind: null, deleted: true } : null));
}

export async function sendMessage(viewerId, conversationId, text, clientId = "", attachmentId = null, replyTo = null) {
  const clean = String(text ?? "").trim();
  if (!clean && !attachmentId) throw new AppError(422, "Write a message first.");
  if (clean.length > MAX_MESSAGE) {
    throw new AppError(422, `Messages are up to ${MAX_MESSAGE} characters.`);
  }

  const conversation = await conversationMembers(conversationId);
  await assertMember(conversation, viewerId);

  assertChatWritable(conversation);

  const clientRef = String(clientId ?? "").slice(0, 64);

  /*
   * A retry of the same optimistic send must not become a second bubble. The
   * client generates `clientId` once per message, so an existing row with that
   * id in this thread is the same message arriving twice.
   */
  if (clientRef) {
    const already = await Message.findOne({
      conversation: conversation._id,
      from: viewerId,
      clientId: clientRef,
    }).lean();
    if (already) {
      return {
        message: messageItem(already, viewerId, already.replyTo ? replyView(await Message.findOne({ _id: already.replyTo, conversation: conversation._id, hiddenFor: mongoose.trusted({ $ne: viewerId }) }).lean()) : null),
        memberIds: conversation.members.map(asId),
        conversationId: asId(conversation._id),
        duplicate: true,
      };
    }
  }

  const reply = replyTo ? await Message.findOne({ _id: replyTo, conversation: conversation._id, hiddenFor: mongoose.trusted({ $ne: viewerId }), deletedAt: null }).lean() : null;
  if (replyTo && !reply) throw new AppError(422, "That message is no longer available to reply to.");
  const upload = attachmentId ? await claimUpload(viewerId, attachmentId, "chat", clientRef || randomUUID(), conversationId) : null;
  let message;
  try {
    message = await Message.create({
    conversation: conversation._id,
    from: viewerId,
    text: clean,
    attachment: upload?.attachment ?? null,
    replyTo: reply?._id ?? null,
    clientId: clientRef,
    readBy: [viewerId],
    });
  } catch (error) {
    if (upload) await MediaUpload.updateOne({ _id: upload._id, usedBy: upload.usedBy }, { $set: { usedBy: null } });
    throw error;
  }

  await Conversation.updateOne(
    { _id: conversation._id },
    {
      $set: {
        lastMessageText: clean || ({image: "Photo", video: "Video", audio: "Audio"}[upload?.kind] ?? "Attachment"),
        lastMessageFrom: viewerId,
        lastMessageAt: message.createdAt,
      },
    }
  );

  return {
    message: messageItem(message, viewerId, replyView(reply)),
    raw: {
      id: asId(message._id),
      conversationId: asId(message.conversation),
      from: asId(message.from),
      text: message.text,
    attachment: message.attachment ?? null,
      clientId: message.clientId ?? "",
      createdAt: message.createdAt,
    },
    memberIds: conversation.members.map(asId),
    conversationId: asId(conversation._id),
  };
}

export async function markRead(viewerId, conversationId, messageIds) {
  const conversation = await conversationMembers(conversationId);
  await assertMember(conversation, viewerId);
  const filter = {
    conversation: conversation._id,
    hiddenFor: mongoose.trusted({ $ne: viewerId }),
    deletedAt: null,
    from: mongoose.trusted({ $ne: viewerId }),
    ...(messageIds
      ? { _id: mongoose.trusted({ $in: messageIds }) }
      : { readBy: mongoose.trusted({ $ne: viewerId }) }),
  };
  // Snapshot exact IDs before writing: a concurrent new message must not be
  // acknowledged just because it arrived while this read request was running.
  const rows = await Message.find(filter).select("_id").lean();
  const ids = rows.map((message) => asId(message._id));
  if (ids.length) {
    await Message.updateMany(
      { conversation: conversation._id, _id: mongoose.trusted({ $in: ids }) },
      { $addToSet: { readBy: viewerId } }
    );
  }
  const unread = await Message.countDocuments({
    conversation: conversation._id,
    hiddenFor: mongoose.trusted({ $ne: viewerId }),
    deletedAt: null,
    from: mongoose.trusted({ $ne: viewerId }),
    readBy: mongoose.trusted({ $ne: viewerId }),
  });
  return { conversationId: asId(conversation._id), messageIds: ids, unread };
}

export async function unreadTotal(viewerId) {
  const hidden = await hiddenCommunityIds();
  const conversations = await Conversation.find({
    members: mongoose.trusted({ $all: [viewerId], $nin: hidden }),
  }).select("_id").lean();
  if (!conversations.length) return 0;
  return Message.countDocuments({
    conversation: mongoose.trusted({ $in: conversations.map((conversation) => conversation._id) }),
    hiddenFor: mongoose.trusted({ $ne: viewerId }),
    deletedAt: null,
    from: mongoose.trusted({ $ne: viewerId }),
    readBy: mongoose.trusted({ $ne: viewerId }),
  });
}

export async function summary(viewerId) {
  const hidden = await hiddenCommunityIds();
  const [unread, requests] = await Promise.all([
    unreadTotal(viewerId),
    ChatRequest.countDocuments({ to: viewerId, status: "pending", from: mongoose.trusted({ $nin: hidden }) }),
  ]);
  return { unread, requests, online: onlineCount() };
}

/** Message shape shared by the REST routes and the socket, for every viewer. */
export { messageItem as toMessageItem };

export async function markSeen(userId) {
  await User.updateOne({ _id: userId }, { $set: { lastSeenAt: new Date() } });
}

/** Who should receive an event about this conversation. */
export async function conversationAudience(conversationId) {
  const conversation = await Conversation.findById(conversationId).select("members").lean();
  if (!conversation) return [];
  const visible = await usersByIds(conversation.members);
  return visible.size === conversation.members.length ? conversation.members.map(asId) : [];
}

/**
 * The other half of a thread, or an empty list when this account is not a
 * member of it. Doubles as the socket layer's membership check.
 */
export async function conversationPeers(conversationId, viewerId) {
  const conversation = await Conversation.findById(conversationId).select("members blockedBy").lean();
  if (!conversation) return [];
  assertChatWritable(conversation);
  await assertMember(conversation, viewerId);
  return conversation.members.map(asId).filter((member) => member !== asId(viewerId));
}

/** A profile by id, in the same shape every other list returns. */
export async function personView(userId) {
  const user = await User.findOne({ _id: userId, ...communityUserFilter() }).select("name lastSeenAt avatar").lean();
  return user ? person(user) : null;
}

/**
 * One thread as one of its members sees it. Broadcasts use this per recipient
 * instead of reusing the sender's summary, because `unread` and the person
 * shown in the row both depend on whose screen it is.
 */
export async function conversationSummaryFor(viewerId, conversationId) {
  const conversation = await Conversation.findById(conversationId).lean();
  if (!conversation) return null;
  if (!conversation.members.map(asId).includes(asId(viewerId))) return null;
  const visible = await usersByIds(conversation.members);
  if (visible.size !== conversation.members.length) return null;

  const otherId = conversation.members.map(asId).find((member) => member !== asId(viewerId));
  if (!otherId) return null;
  const other = visible.get(otherId);
  if (!other) return null;

  const self = new mongoose.Types.ObjectId(asId(viewerId));
  const unread = await Message.countDocuments({
    conversation: conversation._id,
    hiddenFor: mongoose.trusted({ $ne: viewerId }),
    deletedAt: null,
    from: mongoose.trusted({ $ne: self }),
    readBy: mongoose.trusted({ $ne: self }),
  });

  return conversationSummary(conversation, viewerId, other, unread);
}

/** Shared authorization for issuing and confirming media upload grants. */
export async function authorizeConversation(viewerId, conversationId, write = true) {
  const conversation = await conversationMembers(conversationId);
  await assertMember(conversation, viewerId);
  if (write) assertChatWritable(conversation);
  return conversation;
}

/** Build live updates separately, including the recipient's reply visibility. */
export async function messageViewFor(viewerId, conversationId, messageId) {
  const message = await Message.findOne({ _id: messageId, conversation: conversationId, hiddenFor: mongoose.trusted({ $ne: viewerId }) }).lean();
  if (!message) return null;
  const target = message.replyTo ? await Message.findOne({ _id: message.replyTo, conversation: conversationId, hiddenFor: mongoose.trusted({ $ne: viewerId }) }).lean() : null;
  return messageItem(message, viewerId, message.replyTo ? replyView(target) ?? { id: String(message.replyTo), from: "", text: "", kind: null, deleted: true } : null);
}
