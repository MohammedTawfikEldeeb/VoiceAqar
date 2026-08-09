import { Request, Response } from 'express';
import path from 'node:path';

/**
 * Serves the voice chat client UI.
 */
export function serveVoicePage(req: Request, res: Response) {
  res.sendFile(path.resolve('test_voice_client.html'));
}

/**
 * Handles incoming Twilio calls by returning TwiML instructions
 * to establish a bidirectional audio media stream over WebSocket.
 */
export function handleTwilioIncomingCall(req: Request, res: Response) {
  const callerPhone = req.body.From || 'unknown';
  console.log(`📞 Twilio: Incoming call from ${callerPhone}`);

  res.type('text/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Zeina" language="ar-EG">أهلاً بك في صوت عقار يا فندم! جاري الاتصال بالـمُساعد الذكي، يرجى الانتظار.</Say>
  <Connect>
    <Stream url="wss://${req.headers.host}/ws/twilio?phone=${encodeURIComponent(callerPhone)}" />
  </Connect>
</Response>`);
}
