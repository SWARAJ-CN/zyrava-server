import { Router } from "express";
import { appearanceRoutes } from "./appearanceRoutes.js";
import { authRoutes } from "./authRoutes.js";
import { libraryRoutes } from "./libraryRoutes.js";
import { visitRoutes } from "./visitRoutes.js";
import { communityRoutes } from "./communityRoutes.js";
import { adminRoutes } from "../admin/routes/index.js";

import { customizationRoutes } from "./customizationRoutes.js";

import { mediaRoutes } from "./mediaRoutes.js";
import { profileRoutes } from "./profileRoutes.js";

export const routes = Router();
routes.use("/media", mediaRoutes);
routes.use("/profile", profileRoutes);

routes.use("/appearance", appearanceRoutes);
routes.use("/auth", authRoutes);
routes.use("/library", libraryRoutes);
routes.use("/visits", visitRoutes);
routes.use("/community", communityRoutes);
routes.use("/customization", customizationRoutes);
routes.use("/admin", adminRoutes);

routes.get("/", (req, res) => {
  res.json({ name: "ZYRAVA API", version: 1, status: "ok" });
});
