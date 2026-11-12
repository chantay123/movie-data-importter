"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isAdminRequest = isAdminRequest;
exports.requireAdmin = requireAdmin;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const app_config_1 = require("../config/app.config");
/**
 * Checks whether the request carries a valid admin credential.
 *
 * @param req - The incoming request.
 * @returns `true` when the request is allowed to continue.
 */
function isAdminRequest(req) {
    const apiKey = req.header('x-import-api-key') ?? req.query['apiKey'];
    if (app_config_1.appConfig.adminApiKey.length > 0 && apiKey === app_config_1.appConfig.adminApiKey) {
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
        const payload = jsonwebtoken_1.default.verify(token, secret);
        if (!payload) {
            return false;
        }
        const role = String(payload.role ?? '').toLowerCase();
        return payload.isAdmin === true || role === 'admin';
    }
    catch {
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
function requireAdmin(req, res, next) {
    if (isAdminRequest(req)) {
        next();
        return;
    }
    res.status(401).json({
        success: false,
        message: 'Admin authentication is required to use the importer',
    });
}
//# sourceMappingURL=adminAuth.js.map