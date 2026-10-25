import { AppError } from "../utils/http.js";

export function notFound(req, res) {
  res.status(404).json({ error: "Not found." });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(error, req, res, next) {
  if (error instanceof AppError) {
    return res.status(error.status).json({
      error: error.message,
      ...(error.details ? { details: error.details } : {}),
    });
  }

  if (error?.code === 11000) {
    return res.status(409).json({ error: "An account with that email or phone already exists." });
  }

  if (error?.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Invalid JSON body." });
  }

  if (error?.type === "entity.too.large") {
    return res.status(413).json({ error: "Request body is too large." });
  }

  console.error("[zyrava] unhandled error:", error);
  return res.status(500).json({ error: "Something went wrong. Please try again." });
}
