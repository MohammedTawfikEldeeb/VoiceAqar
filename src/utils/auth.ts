import type { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import { env } from '../config/env.js';

/** Constant-time string comparison for shared secrets. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Express middleware requiring the request to carry the shared API token.
 * When API_AUTH_TOKEN is not configured (local dev), the middleware is a no-op.
 */
export function requireApiToken(req: Request, res: Response, next: NextFunction) {
  if (!env.API_AUTH_TOKEN) return next();

  const provided = req.headers['x-api-token'];
  if (typeof provided !== 'string' || provided.length === 0) {
    return res.status(401).json({ error: 'Missing x-api-token header' });
  }

  const expected = Buffer.from(env.API_AUTH_TOKEN);
  const actual = Buffer.from(provided);
  if (
    expected.length !== actual.length ||
    !crypto.timingSafeEqual(expected, actual)
  ) {
    return res.status(401).json({ error: 'Invalid API token' });
  }

  next();
}

/**
 * Express middleware enforcing rate limits. Uses a simple in-memory sliding
 * window. Do NOT use behind multiple instances without a shared store, but it
 * is fine for a single-process deployment or behind nginx rate limiting.
 */
export function createRateLimiter(
  windowMs: number,
  max: number,
  message = 'Too many requests, please try again later.'
) {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return ((req: Request, res: Response, next: NextFunction) => {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();

    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }

    entry.count += 1;
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - entry.count)));

    if (entry.count > max) {
      res.status(429).json({ error: message });
      return;
    }

    // Opportunistic cleanup to avoid unbounded map growth
    if (hits.size > 10_000) {
      for (const [k, v] of hits) {
        if (v.resetAt <= now) hits.delete(k);
      }
    }

    next();
  }) as unknown as (req: Request, res: Response, next: NextFunction) => void;
}

/**
 * Verifies the Twilio X-Twilio-Signature header for a POST webhook.
 * Returns true when valid, or when no auth token is configured (dev mode).
 *
 * See: https://www.twilio.com/docs/usage/webhooks/webhooks-security
 */
export function isValidTwilioSignature(
  twilioSignature: string | undefined,
  requestUrl: string,
  formBody: Record<string, unknown>
): boolean {
  if (!env.TWILIO_AUTH_TOKEN) return true;

  if (!twilioSignature) return false;

  const url = new URL(requestUrl);
  url.search = ''; // Twilio signature is computed over the URL without the query string

  // Sort POST params by key and build key=value pairs (RFC 3986 form encoding)
  const params = Object.keys(formBody)
    .sort()
    .map((key) => `${key}${formBody[key]}`)
    .join('');

  const expected = crypto
    .createHmac('sha1', env.TWILIO_AUTH_TOKEN)
    .update(`${url.href}${params}`)
    .digest('base64');

  const a = Buffer.from(expected);
  const b = Buffer.from(twilioSignature);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}