import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { appConfig } from '../config/app.config';

/**
 * Authentication of the admin panel.
 *
 * Two mechanisms are accepted:
 *   1. a shared secret sent through the `x-import-api-key` header (used by
 *      the standalone admin panel),
 *   2. a JWT issued by the main backend whose payload carries the `admin`
 *      role (used when the panel is integrated into the existing admin area).
 *
 * The MongoDB credentials are never exposed: the importer only proxies the
 * writes through its own backend.
 */

/**
 * Shape of the decoded JWT payload.
 */
interface AdminTokenPayload {
  /** Role of the user. */
  role?: string;
  /** Flag used by the main backend to mark an administrator. */
  isAdmin?: boolean;
  /** Subject of the token. */
  sub?: string;
}

/**
 * Checks whether the request carries a valid admin credential.
 *
 * @param req - The incoming request.
 * @returns `true` when the request is allowed to continue.
 */
export function isAdminRequest(req: Request): boolean {
  const apiKey = req.header('x-import-api-key') ?? req.query['apiKey'];

  if (appConfig.adminApiKey.length > 0 && apiKey === appConfig.adminApiKey) {
    return true;
  }

  const header = req.header('authorization');
  if (!header) {
    return false;
  }

  const token = header.startsWith('Bearer ') ? header.slice(7) : header;
  const secret = process.env['JWT_SECRET'] ?? process.env['AUTH_JWT_SECRET'] ?? '';

  if (secret.length === 0) {
    return false;
  }

  try {
    const payload = jwt.verify(token, secret) as AdminTokenPayload;

    if (!payload) {
      return false;
    }

    const role = String(payload.role ?? '').toLowerCase();
    return payload.isAdmin === true || role === 'admin';
  } catch {
    return false;
  }
}

/**
 * Express middleware that rejects the requests without an admin credential.
 *
 * @param req - The incoming request.
 * @param res - The response object.
 * @param next - The next middleware of the chain.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (isAdminRequest(req)) {
    next();
    return;
  }

  res.status(401).json({
    success: false,
    message: 'Admin authentication is required to use the importer',
  });
}
