import { Router } from "express";
import { requireAdmin } from "../middleware/auth.js";
import { authRoutes } from "./auth.js";
import { overviewRoutes } from "./overview.js";
import { usersRoutes } from "./users.js";
import { visitsRoutes } from "./visits.js";
import { audienceRoutes } from "./audience.js";
import { contentRoutes } from "./content.js";
import { sessionsRoutes } from "./sessions.js";
import { systemRoutes } from "./system.js";

export const adminRoutes = Router();

adminRoutes.use("/auth", authRoutes);
adminRoutes.use(requireAdmin);
adminRoutes.use("/overview", overviewRoutes);
adminRoutes.use("/users", usersRoutes);
adminRoutes.use("/visits", visitsRoutes);
adminRoutes.use("/audience", audienceRoutes);
adminRoutes.use("/content", contentRoutes);
adminRoutes.use("/sessions", sessionsRoutes);
adminRoutes.use("/system", systemRoutes);
