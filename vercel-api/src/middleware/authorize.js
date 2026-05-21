import { hasPermission } from "../lib/permissions.js";
import { HttpError } from "../lib/http-error.js";

export function allowRoles(roles) {
  return function roleMiddleware(req, res, next) {
    const role = String(req.auth?.profile?.role || "").toLowerCase();
    const allowed = roles.map(function (item) {
      return String(item).toLowerCase();
    });
    if (!allowed.includes(role)) {
      return next(new HttpError(403, "You do not have access to this resource"));
    }
    next();
  };
}

export function requirePermission(permission) {
  return function permissionMiddleware(req, res, next) {
    const role = req.auth?.profile?.role;
    if (!hasPermission(role, permission)) {
      return next(new HttpError(403, "Missing permission: " + permission));
    }
    next();
  };
}
