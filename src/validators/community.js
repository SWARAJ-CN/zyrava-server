import { z } from "zod";

/**
 * Same envelope shape as `validators/library.js`: body, query and params are
 * parsed together and nothing reaches a handler unparsed. Writes send a body
 * only; reads send a query only, and both are `.strict()` so an unexpected key
 * is a rejection rather than a silently ignored one.
 */
export const MAX_MESSAGE = 2000;
export const MAX_PEOPLE_QUERY = 80;

/** Mongo ObjectId text — the only shape accepted for an id on this router. */
const idSchema = z
  .string()
  .trim()
  .regex(/^[a-f\d]{24}$/i, "That reference is not valid.");

const bodyOnly = (body) =>
  z.object({ body, query: z.object({}).strict(), params: z.object({}).strict() }).strict();

const queryOnly = (query) =>
  z.object({ body: z.object({}).strict(), query, params: z.object({}).strict() }).strict();

const none = z.object({}).strict();

export const summarySchema = queryOnly(none);

export const peopleSchema = queryOnly(
  z
    .object({
      q: z.string().trim().max(MAX_PEOPLE_QUERY).optional().default(""),
    })
    .strict()
);

export const requestsSchema = queryOnly(none);

export const conversationsSchema = queryOnly(none);

export const messagesSchema = queryOnly(
  z
    .object({
      conversationId: idSchema,
      /** An ISO timestamp: the page of history before it. Unreadable values
       *  are ignored by the service, which falls back to the newest page. */
      before: z.string().trim().max(64).optional(),
    })
    .strict()
);

export const sendRequestSchema = bodyOnly(
  z.object({ userId: idSchema }).strict()
);

export const respondSchema = bodyOnly(
  z
    .object({
      requestId: idSchema,
      accept: z.boolean(),
    })
    .strict()
);

export const sendMessageSchema = bodyOnly(
  z
    .object({
      conversationId: idSchema,
      text: z
        .string()
        .trim()
        .min(1, "Write a message first.")
        .max(MAX_MESSAGE, `Messages are up to ${MAX_MESSAGE} characters.`),
      /** The sender's optimistic id, echoed back so the tab can de-duplicate. */
      clientId: z.string().trim().max(64).optional().default(""),
    })
    .strict()
);

export const markReadSchema = bodyOnly(
  z.object({ conversationId: idSchema }).strict()
);
