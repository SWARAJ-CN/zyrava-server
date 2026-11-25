import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
  {
    conversation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
      index: true,
    },
    from: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    replyTo: { type: mongoose.Schema.Types.ObjectId, ref: "Message", default: null },
    editedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
    hiddenFor: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    reactions: { type: Map, of: String, default: () => ({}) },
    revision: { type: Number, default: 0 },
    attachment: { type: mongoose.Schema.Types.Mixed, default: null },
    text: { type: String, default: "", trim: true, maxlength: 2000 },
    /** The sender's optimistic id, echoed back so the client can de-duplicate. */
    clientId: { type: String, maxlength: 64 },
    readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  },
  { timestamps: true }
);

messageSchema.index({ conversation: 1, createdAt: -1 });

export const Message = mongoose.model("Message", messageSchema, "messages");
