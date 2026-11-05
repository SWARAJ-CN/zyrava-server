import { adminEnv } from "../env.js";
import { AppError } from "../../utils/http.js";

/**
 * Express middleware: gate every destructive admin route behind the
 * server-side ADMIN_ALLOW_DELETE switch. When allowed it must hand control to
 * the route handler, otherwise the request would hang with no response.
 */
export function requireDeleteEnabled(req, res, next) {
  if (!adminEnv.allowDelete) {
    return next(new AppError(403, "Delete actions are disabled by the administrator."));
  }
  return next();
}
