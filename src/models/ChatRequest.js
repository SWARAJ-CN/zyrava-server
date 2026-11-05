import mongoose from "mongoose";

/**
 * A request from one listener to chat with another. Requests are the gate:
 * no message can be written until the pair has an accepted conversation.
 *
 * A request is directional, so "incoming" and "outgoing" are both readable
 * from the viewer's side. Re-sending after a decline reuses the same row.
 */
const chatRequestSchema = new mongoose.Schema(
  {
    from: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    to: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["pending", "accepted", "declined"],
      default: "pending",
      index: true,
    },
    respondedAt: { type: Date },
  },
  { timestamps: true }
);

// One row per direction; the service flips a declined row back to pending.
chatRequestSchema.index({ from: 1, to: 1 }, { unique: true });
chatRequestSchema.index({ to: 1, status: 1, updatedAt: -1 });

export const ChatRequest = mongoose.model("ChatRequest", chatRequestSchema, "chat_requests");
