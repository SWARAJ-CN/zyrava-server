import mongoose from "mongoose";

/**
 * One accepted 1:1 thread. `pairKey` is the sorted pair of ids, which makes
 * "is there a conversation between these two?" a unique-index lookup rather
 * than a scan over an array field.
 */
const conversationSchema = new mongoose.Schema(
  {
    pairKey: { type: String, required: true, unique: true, index: true },
    members: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
      required: true,
      validate: {
        validator: (value) => Array.isArray(value) && value.length === 2,
        message: "A conversation has exactly two members.",
      },
    },
    lastMessageText: { type: String, default: "", maxlength: 2000 },
    lastMessageFrom: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    lastMessageAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

conversationSchema.index({ members: 1, lastMessageAt: -1 });

export const Conversation = mongoose.model("Conversation", conversationSchema, "conversations");
