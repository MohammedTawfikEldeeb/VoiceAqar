import { Request, Response } from 'express';
import path from 'node:path';
import crypto from 'node:crypto';
import { db } from '../config/db.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { agent, getAgentCallbacks } from '../agent/voiceaqar_agent.js';
import { memoryManager } from '../infrastructure/memory/index.js';

export const activeSessions = new Set<string>();

/**
 * Handles text-based chat interactions.
 */
export async function handleChat(req: Request, res: Response) {
  try {
    const { message, phoneNumber, sessionId } = req.body;
    const activeSessionId = sessionId || `sess_${Date.now()}`;
    const activePhone = phoneNumber || 'unknown_phone';

    let activeUserId = '';
    let userName = 'anonymous';

    const foundUsers = await db.select().from(users).where(eq(users.phoneNumber, activePhone)).limit(1);
    if (foundUsers.length > 0) {
      activeUserId = foundUsers[0].userId;
      userName = foundUsers[0].name || 'anonymous';
      console.log(` Recognized existing user for phone ${activePhone}: "${userName}" (ID: ${activeUserId})`);
    } else {
      activeUserId = `usr_${crypto.randomUUID()}`;
      await db.insert(users).values({
        userId: activeUserId,
        phoneNumber: activePhone,
      });
      console.log(` Registered new user for phone ${activePhone} (ID: ${activeUserId})`);
    }

    if (!activeSessions.has(activeSessionId)) {
      activeSessions.add(activeSessionId);
      await memoryManager.onCallStart(activeSessionId, activeUserId);
    }

    await memoryManager.onUserMessage(activeSessionId, message, activeUserId);

    const result = await agent.invoke(
      {
        messages: [{ role: 'user', content: message }]
      },
      {
        configurable: { thread_id: activeSessionId },
        callbacks: getAgentCallbacks()
      }
    );

    const lastMessage = result.messages[result.messages.length - 1];
    const reply = typeof lastMessage.content === 'string'
      ? lastMessage.content
      : JSON.stringify(lastMessage.content);

    await memoryManager.onAgentResponse(activeSessionId, reply);

    res.json({ reply, sessionId: activeSessionId, userId: activeUserId, name: userName });
  } catch (error: any) {
    console.error(' Error in handleChat:', error);
    res.status(500).json({ error: error.message || String(error) });
  }
}

/**
 * Ends a chat session and resets context.
 */
export async function endChat(req: Request, res: Response) {
  try {
    const { sessionId, userId } = req.body;
    if (sessionId) {
      activeSessions.delete(sessionId);
      await memoryManager.onCallEnd(sessionId, userId || 'anonymous');
    }
    res.json({ success: true });
  } catch (error: any) {
    console.error(' Error in endChat:', error);
    res.status(500).json({ error: error.message || String(error) });
  }
}

/**
 * Serves the text chat client UI.
 */
export function serveChatPage(req: Request, res: Response) {
  res.sendFile(path.resolve('test_text_client.html'));
}
