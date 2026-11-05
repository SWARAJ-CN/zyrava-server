import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { verifyCsrf } from "../middleware/csrf.js";
import { chatReadLimiter, chatRequestLimiter, chatSendLimiter } from "../middleware/rateLimit.js";
import { validate } from "../middleware/validate.js";
import {
  conversationsSchema,
  markReadSchema,
  messagesSchema,
  peopleSchema,
  requestsSchema,
  respondSchema,
  sendMessageSchema,
  sendRequestSchema,
  summarySchema,
} from "../validators/community.js";
import * as communityController from "../controllers/communityController.js";

export const communityRoutes = Router();

/** Chat belongs to a signed-in listener; there is no public thread. */
communityRoutes.use(requireAuth);

// Writes are POST-only with the verb in the path, the same contract the library
// router uses, so no CORS method widening and no preflight is needed.
communityRoutes.get("/summary", validate(summarySchema), communityController.summary);
communityRoutes.get("/people", validate(peopleSchema), communityController.people);
communityRoutes.get("/requests", validate(requestsSchema), communityController.requests);
communityRoutes.get(
  "/conversations",
  validate(conversationsSchema),
  communityController.conversations
);
communityRoutes.get("/messages", validate(messagesSchema), communityController.messages);

communityRoutes.post(
  "/request",
  verifyCsrf,
  chatRequestLimiter,
  validate(sendRequestSchema),
  communityController.sendRequest
);
communityRoutes.post(
  "/respond",
  verifyCsrf,
  chatRequestLimiter,
  validate(respondSchema),
  communityController.respondRequest
);
communityRoutes.post(
  "/message",
  verifyCsrf,
  chatSendLimiter,
  validate(sendMessageSchema),
  communityController.sendMessage
);
communityRoutes.post(
  "/read",
  verifyCsrf,
  chatReadLimiter,
  validate(markReadSchema),
  communityController.markRead
);
