import { Request, Response } from 'express';
import path from 'node:path';

/**
 * Serves the voice chat client UI.
 */
export function serveVoicePage(req: Request, res: Response) {
  res.sendFile(path.resolve('test_voice_client.html'));
}
