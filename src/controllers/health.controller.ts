import { Request, Response } from 'express';
import { pool } from '../config/db.js';
import { redis } from '../config/redis.js';

/**
 * Handles server health checks and reports the liveness of critical
 * dependencies (PostgreSQL, Redis).
 */
export async function handleHealth(req: Request, res: Response) {
  const checks: Record<string, 'ok' | 'error'> = {};
  let healthy = true;

  try {
    await pool.query('SELECT 1');
    checks.postgres = 'ok';
  } catch (err) {
    checks.postgres = 'error';
    healthy = false;
  }

  try {
    await redis.ping();
    checks.redis = 'ok';
  } catch (err) {
    checks.redis = 'error';
    healthy = false;
  }

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    message: healthy ? 'VoiceAqar Server is running' : 'VoiceAqar Server has dependency issues',
    checks,
    timestamp: new Date().toISOString(),
  });
}