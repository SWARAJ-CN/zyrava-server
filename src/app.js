import express from "express";
import helmet from "helmet";
import cors from "cors";
import compression from "compression";
import cookieParser from "cookie-parser";
import { env } from "./config/env.js";
import { dbStatus } from "./config/db.js";
import { routes } from "./routes/index.js";
import { globalLimiter } from "./middleware/rateLimit.js";
import { errorHandler, notFound } from "./middleware/errorHandler.js";
import { AppError } from "./utils/http.js";

export const app = express();

// Render / any reverse proxy terminates TLS; trust it for rate-limit IPs.
app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    // The API answers JSON only; the SPA's CSP belongs to Next.
    contentSecurityPolicy: false,
  })
);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || env.clientOrigins.includes(origin.replace(/\/$/, ""))) {
        return callback(null, true);
      }
      return callback(new AppError(403, "Origin not allowed."));
    },
    credentials: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-CSRF-Token"],
    maxAge: 86_400,
  })
);

app.use(compression());
// A library write carries whole song snapshots, so that router gets a higher
// body ceiling than the auth endpoints; its routes still cap tracks per call.
app.use("/api/library", express.json({ limit: "64kb", strict: true }));
app.use(express.json({ limit: "16kb", strict: true }));
app.use(cookieParser());

// Health checks stay outside the limiter for uptime monitors.
app.get("/health", (req, res) => {
  const db = dbStatus();
  res.status(db === "up" ? 200 : 503).json({
    ok: db === "up",
    db,
    uptime: Math.round(process.uptime()),
  });
});

app.use(globalLimiter);
app.use("/api", routes);

app.use(notFound);
app.use(errorHandler);
