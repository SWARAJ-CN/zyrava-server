import { Router } from "express";
import { authRoutes } from "./authRoutes.js";
import { libraryRoutes } from "./libraryRoutes.js";
import { visitRoutes } from "./visitRoutes.js";

export const routes = Router();

routes.use("/auth", authRoutes);
routes.use("/library", libraryRoutes);
routes.use("/visits", visitRoutes);

routes.get("/", (req, res) => {
  res.json({ name: "ZYRAVA API", version: 1, status: "ok" });
});
