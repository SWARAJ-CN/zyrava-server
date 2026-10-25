import { z } from "zod";
import { EVENT_KINDS } from "../models/historyEvent.js";
import { songSchema } from "./library.js";

/** Per request. The route's 64 kB ceiling covers thirty events plus twelve tracks. */
export const MAX_EVENTS_PER_REQUEST = 30;
export const MAX_SNAPSHOTS_PER_REQUEST = 12;

/** What the store keeps per account: past this the oldest rows go, never a refusal. */
export const MAX_EVENTS_KEPT = 3000;
export const MAX_SONGS_KEPT = 1200;

/** Clocks lie, so a stamp further out than this is pulled back to the edge. */
export const MAX_EVENT_AGE_DAYS = 180;
export const MAX_FUTURE_SKEW_MINUTES = 5;

/** Sizes of the profile `/state` answers with; the app does the thinking. */
export const MAX_PLAYABLE = 24;
export const MAX_HEARD = 120;
export const MAX_ARTISTS = 12;
export const MAX_LANGUAGES = 8;
export const MAX_QUERIES = 12;

const eidSchema = z.string().trim().min(1, "Which event is this?").max(64);
const songIdSchema = z.string().trim().min(1, "Which track?").max(64);
const querySchema = z.string().trim().min(1, "What did you search for?").max(120);

const eventSchema = z
  .object({
    eid: eidSchema,
    kind: z.enum(EVENT_KINDS, { message: "That is not a listening behaviour." }),
    songId: songIdSchema.optional(),
    q: querySchema.optional(),
    w: z
      .number()
      .finite()
      .min(-100)
      .max(100)
      .optional()
      .default(1),
    pct: z.number().min(0).max(100).optional(),
    at: z.coerce.date(),
  })
  .strict()
  .refine(
    (event) => (event.kind === "search" ? Boolean(event.q) : Boolean(event.songId)),
    { message: "A listen needs a track and a search needs a phrase." }
  );

const eventsBody = z
  .array(eventSchema)
  .min(1, "Nothing happened?")
  .max(MAX_EVENTS_PER_REQUEST, "Too many events in one go.");

/** A track an event mentioned, with the snapshot the app was holding. */
const snapshotSchema = z
  .object({ songId: songIdSchema, song: songSchema })
  .strict();

const snapshotsSchema = z
  .array(snapshotSchema)
  .max(MAX_SNAPSHOTS_PER_REQUEST, "Too many tracks in one go.");

const envelope = (body) =>
  z.object({ body, query: z.object({}).strict(), params: z.object({}).strict() }).strict();

export const historyEventsSchema = envelope(
  z.object({ events: eventsBody, songs: snapshotsSchema.optional().default([]) }).strict()
);

export const historyClearSchema = envelope(z.object({}).strict());

/** No query parameters: `/state` answers with the whole profile or nothing. */
export const historyStateSchema = envelope(z.object({}).strict());
