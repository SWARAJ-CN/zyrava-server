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

        .max(MAX_MESSAGE, `Messages are up to ${MAX_MESSAGE} characters.`),
      /** The sender's optimistic id, echoed back so the tab can de-duplicate. */
      attachmentId: idSchema.optional(),
      replyTo: idSchema.optional(),
      clientId: z.string().trim().max(64).optional().default(""),
    })
    .strict().refine(value => value.text.length > 0 || !!value.attachmentId, "Write a message or attach a file.")
);

export const markReadSchema = bodyOnly(
  z.object({ conversationId: idSchema, messageIds: z.array(idSchema).min(1).max(100).optional() }).strict()
);

export const conversationActionSchema = bodyOnly(z.object({ conversationId: idSchema }).strict());
export const blockSchema = bodyOnly(z.object({ conversationId: idSchema, blocked: z.boolean() }).strict());
export const editMessageSchema = bodyOnly(z.object({ conversationId: idSchema, messageId: idSchema, text: z.string().trim().min(1).max(MAX_MESSAGE) }).strict());
export const deleteMessageSchema = bodyOnly(z.object({ conversationId: idSchema, messageId: idSchema, scope: z.enum(["me", "everyone"]) }).strict());
export const REACTIONS = ["❤️", "😂", "😮", "👍"];
export const reactMessageSchema = bodyOnly(z.object({ conversationId: idSchema, messageId: idSchema, emoji: z.enum(REACTIONS).nullable() }).strict());
