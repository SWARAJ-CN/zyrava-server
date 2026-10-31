import { z } from "zod";

const envelope = (body) =>
  z.object({ body, query: z.object({}).strict(), params: z.object({}).strict() }).strict();

/**
 * The three fields a browser can honestly offer at the moment of arrival. The
 * address and the user agent come from the request itself, never the body, so
 * a script cannot claim a location it was not given.
 */
export const captureVisitSchema = envelope(
  z
    .object({
      clientId: z.string().trim().min(8, "Which device is this?").max(64),
      path: z.string().trim().min(1, "Which page?").max(300),
      referrer: z.string().trim().max(300).optional(),
    })
    .strict()
);
