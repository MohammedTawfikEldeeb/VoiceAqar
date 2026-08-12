import { Request, Response } from 'express';
import path from 'node:path';
import { isValidTwilioSignature } from '../utils/auth.js';
import { env } from '../config/env.js';

/**
 * Serves the voice chat client UI.
 */
export function serveVoicePage(req: Request, res: Response) {
  res.sendFile(path.resolve('test_voice_client.html'));
}

/**
 * Handles incoming Twilio calls by returning TwiML instructions
 * to establish a bidirectional audio media stream over WebSocket.
 *
 * The webhook is protected against spoofing by validating the
 * X-Twilio-Signature header when TWILIO_AUTH_TOKEN is configured.
 */
export function handleTwilioIncomingCall(req: Request, res: Response) {
  const callerPhone = (req.body?.From || 'unknown').toString().substring(0, 50);

  const signature = req.headers['x-twilio-signature'] as string | undefined;
  const requestUrl = `${req.protocol}://${req.headers.host}${req.originalUrl}`;
  const formBody = req.body || {};

  if (!isValidTwilioSignature(signature, requestUrl, formBody)) {
    console.warn(` Twilio webhook signature validation failed for call from ${callerPhone}`);
    res.status(403).type('text/plain').send('Invalid Twilio signature');
    return;
  }

  console.log(` Twilio: Incoming call from ${callerPhone}`);

  // Optionally authenticate the media-stream WebSocket with the shared token
  const tokenParam = env.WSS_ACCESS_TOKEN
    ? `&access_token=${encodeURIComponent(env.WSS_ACCESS_TOKEN)}`
    : '';

  res.type('text/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Zeina" language="ar-EG">أهلاً بك في صوت عقار يا فندم! جاري الاتصال بالـمُساعد الذكي، يرجى الانتظار.</Say>
  <Connect>
    <Stream url="wss://${req.headers.host}/ws/twilio?phone=${encodeURIComponent(callerPhone)}${tokenParam}" />
  </Connect>
</Response>`);
}