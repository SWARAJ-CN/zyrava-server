import "dotenv/config";
import mongoose from "mongoose";
import { cleanupUploads } from "../src/services/mediaService.js";
try {
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`Removed ${await cleanupUploads()} expired media uploads.`);
} finally { await mongoose.disconnect(); }
