import { z } from "zod";

/** Limits the app already holds itself to, enforced here too. */
export const MAX_PLAYLISTS = 30;
export const MAX_PLAYLIST_NAME = 40;
export const MAX_LIKED = 2000;
export const MAX_SONGS_PER_PLAYLIST = 500;

/**
 * Tracks per request. Fifteen is provably inside the route's 64 kB body limit
 * even with every field at its maximum length, and it is how the app chunks a
 * device's existing library when it uploads it for the first time.
 */
export const MAX_SONGS_PER_REQUEST = 15;

/** A track as the app knows it; only id and title are load-bearing. */
const songSchema = z.object({
  id: z.string().trim().min(1, "The catalogue id is missing.").max(64),
  title: z.string().trim().min(1, "Give the track a title.").max(300),
  artist: z.string().trim().max(300).optional().default(""),
  album: z.string().trim().max(300).optional().default(""),
  year: z.string().trim().max(16).optional().default(""),
  language: z.string().trim().max(40).optional().default(""),
  duration: z
    .number()
    .min(0)
    .max(86_400)
    .transform((value) => Math.round(value))
    .optional()
    .default(0),
  image: z.string().trim().max(500).optional().default(""),
  imageLarge: z.string().trim().max(500).optional().default(""),
  streamUrl: z.string().trim().max(1000).optional().default(""),
  pageUrl: z.string().trim().max(500).optional().default(""),
});
// Unknown keys a catalogue change may add are dropped, never stored.

const songsSchema = z
  .array(songSchema)
  .min(1, "Nothing to save.")
  .max(MAX_SONGS_PER_REQUEST, "Too many tracks in one go.");

/** The id the app generated for a playlist — a uuid, unique per account. */
const keySchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{8,64}$/, "Playlist reference is not valid.");

const songIdSchema = z.string().trim().min(1, "Which track?").max(64);

const nameSchema = z
  .string()
  .trim()
  .min(1, "Give the playlist a name.")
  .max(MAX_PLAYLIST_NAME, "Playlist names are up to 40 characters.");

const envelope = (body) =>
  z.object({ body, query: z.object({}).strict(), params: z.object({}).strict() }).strict();

export const likesSchema = envelope(z.object({ songs: songsSchema }).strict());

export const unlikeSchema = envelope(z.object({ songId: songIdSchema }).strict());

export const createPlaylistSchema = envelope(
  z.object({ key: keySchema, name: nameSchema }).strict()
);

export const deletePlaylistSchema = envelope(z.object({ key: keySchema }).strict());

export const playlistSongsSchema = envelope(
  z.object({ key: keySchema, songs: songsSchema }).strict()
);

export const removePlaylistSongSchema = envelope(
  z.object({ key: keySchema, songId: songIdSchema }).strict()
);
