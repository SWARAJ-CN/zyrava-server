import mongoose from "mongoose";

/**
 * One arrival at the site: which anonymous device came, from which link, and
 * roughly where on earth it was. Kept apart from accounts — a visit exists
 * before any sign-up, and what a member listens to lives in its own
 * collection.
 */
const visitSchema = new mongoose.Schema(
  {
    /** Minted by the browser on first arrival; ties a repeat visit together. */
    clientId: { type: String, required: true, index: true, maxlength: 64 },
    ip: { type: String, required: true, maxlength: 64 },
    country: { type: String, maxlength: 2 },
    region: { type: String, maxlength: 64 },
    city: { type: String, maxlength: 96 },
    /** Where the click happened. A tagged link's utm_source wins over the referrer. */
    source: { type: String, maxlength: 48, index: true },
    medium: { type: String, maxlength: 48 },
    campaign: { type: String, maxlength: 120 },
    /** The referring URL, when the browser was willing to say it. */
    referrer: { type: String, maxlength: 300 },
    /** The page they landed on, query string and all. */
    path: { type: String, required: true, maxlength: 300 },
    userAgent: { type: String, maxlength: 300 },
    language: { type: String, maxlength: 12 },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

visitSchema.index({ createdAt: -1 });
visitSchema.index({ source: 1, createdAt: -1 });

export const Visit = mongoose.model("Visit", visitSchema, "visits");
