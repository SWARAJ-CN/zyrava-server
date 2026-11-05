import { asyncHandler } from "../utils/http.js";
import * as community from "../services/communityService.js";
import * as push from "../realtime/emit.js";

/**
 * Reads answer from the token's own account, exactly like the library router.
 * Writes are REST on purpose — they keep the CSRF header, the validators and
 * the rate limits — and each one ends with a socket push so every live tab of
 * the pair learns about it without polling.
 */

export const summary = asyncHandler(async (req, res) => {
  res.json(await community.summary(req.userId));
});

export const people = asyncHandler(async (req, res) => {
  res.json({ people: await community.listPeople(req.userId, req.valid.query.q) });
});

export const requests = asyncHandler(async (req, res) => {
  res.json(await community.listRequests(req.userId));
});

export const conversations = asyncHandler(async (req, res) => {
  res.json({ conversations: await community.listConversations(req.userId) });
});

export const messages = asyncHandler(async (req, res) => {
  const { conversationId, before } = req.valid.query;
  res.json({ messages: await community.listMessages(req.userId, conversationId, before) });
});

export const sendRequest = asyncHandler(async (req, res) => {
  const targetId = req.valid.body.userId;
  const result = await community.sendRequest(req.userId, targetId);

  if (result.status === "pending") {
    await push.requestReceived(
      targetId,
      { _id: result.request.id, createdAt: result.request.createdAt },
      req.userId
    );
  } else if (result.conversation) {
    // Mutual ask: both sides gain the thread at the same moment.
    await push.conversationOpened([req.userId, targetId], result.conversation.id);
  }

  res.status(result.status === "accepted" ? 200 : 201).json(result);
});

export const respondRequest = asyncHandler(async (req, res) => {
  const { requestId, accept } = req.valid.body;
  const result = await community.respondRequest(req.userId, requestId, accept);

  if (result.from) {
    await push.requestResolved(result.from, requestId, accept);
    if (accept && result.conversation) {
      const requesterId = result.from;
      await push.conversationOpened([req.userId, requesterId], result.conversation.id);
    }
  }

  res.json(result);
});

export const sendMessage = asyncHandler(async (req, res) => {
  const { conversationId, text, clientId } = req.valid.body;
  const result = await community.sendMessage(req.userId, conversationId, text, clientId);

  if (!result.duplicate) {
    await push.messageDelivered(req.userId, result.memberIds, result.message);
    await push.conversationUpdated(result.memberIds, result.conversationId);
  }

  res.status(result.duplicate ? 200 : 201).json({ message: result.message });
});

export const markRead = asyncHandler(async (req, res) => {
  const { conversationId } = req.valid.body;
  const result = await community.markRead(req.userId, conversationId);
  const memberIds = await community.conversationAudience(conversationId);
  push.conversationRead(memberIds, conversationId, req.userId);
  res.json(result);
});
