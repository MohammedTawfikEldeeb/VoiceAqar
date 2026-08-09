import { Request, Response } from 'express';

/**
 * Handles server health checks.
 */
export function handleHealth(req: Request, res: Response) {
  res.json({ status: 'ok', message: 'VoiceAqar Server is running' });
}
