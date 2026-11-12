import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import type { AdminRole } from '../shared/types.js';

const AUTH_SECRET =
  process.env.AUTH_SECRET || crypto.createHash('sha256').update(process.cwd() + ':transit-event-secret-v1').digest('hex');

export const ADMIN_COOKIE_NAME = 'transit_admin_session';
export const PARTICIPANT_COOKIE_NAME = 'transit_participant_session';

export interface AdminSessionPayload {
  id: number;
  email: string;
  nama: string;
  role: AdminRole;
  exp: number;
}

export interface ParticipantSessionPayload {
  id: number;
  email: string;
  exp: number;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, keyHex] = stored.split(':');
  if (!salt || !keyHex) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(keyHex, 'hex');
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}

export function signAdminToken(payload: Omit<AdminSessionPayload, 'exp'>): string {
  const full: AdminSessionPayload = {
    ...payload,
    exp: Date.now() + 12 * 60 * 60 * 1000, // 12 hours
  };
  const encoded = Buffer.from(JSON.stringify(full)).toString('base64url');
  const sig = crypto.createHmac('sha256', AUTH_SECRET).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifyAdminToken(token: string | undefined): AdminSessionPayload | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', AUTH_SECRET).update(encoded).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as AdminSessionPayload;
    if (!parsed || typeof parsed.id !== 'number' || parsed.exp < Date.now()) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = decodeURIComponent(part.slice(idx + 1).trim());
    out[key] = val;
  }
  return out;
}

export interface AuthedRequest extends Request {
  admin?: AdminSessionPayload;
  participant?: ParticipantSessionPayload;
}

export function signParticipantToken(payload: Omit<ParticipantSessionPayload, 'exp'>): string {
  const full: ParticipantSessionPayload = {
    ...payload,
    exp: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 days
  };
  const encoded = Buffer.from(JSON.stringify(full)).toString('base64url');
  const sig = crypto.createHmac('sha256', AUTH_SECRET).update('p:' + encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifyParticipantToken(token: string | undefined): ParticipantSessionPayload | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', AUTH_SECRET).update('p:' + encoded).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as ParticipantSessionPayload;
    if (!parsed || typeof parsed.id !== 'number' || parsed.exp < Date.now()) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function requireParticipant(req: AuthedRequest, res: Response, next: NextFunction) {
  const cookies = parseCookies(req.headers.cookie);
  const payload = verifyParticipantToken(cookies[PARTICIPANT_COOKIE_NAME]);
  if (!payload) {
    res.status(401).json({ error: 'Silakan login dengan email Anda terlebih dahulu untuk memesan atau mengelola kursi.' });
    return;
  }
  req.participant = payload;
  next();
}

export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  const cookies = parseCookies(req.headers.cookie);
  const payload = verifyAdminToken(cookies[ADMIN_COOKIE_NAME]);
  if (!payload) {
    res.status(401).json({ error: 'Sesi admin tidak valid atau sudah berakhir. Silakan login kembali.' });
    return;
  }
  req.admin = payload;
  next();
}

export function requireSuperAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  requireAdmin(req, res, () => {
    if (req.admin?.role !== 'super_admin') {
      res.status(403).json({ error: 'Akses ditolak. Fitur ini hanya untuk Super Admin.' });
      return;
    }
    next();
  });
}

// Simple in-memory rate limiter for login and public lookup/booking
const rateBuckets = new Map<string, number[]>();

export function checkRateLimit(key: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now();
  const list = rateBuckets.get(key) ?? [];
  const valid = list.filter((ts) => now - ts < windowMs);
  if (valid.length >= maxRequests) {
    rateBuckets.set(key, valid);
    return false;
  }
  valid.push(now);
  rateBuckets.set(key, valid);
  return true;
}

export function clearRateLimit(key: string) {
  rateBuckets.delete(key);
}

