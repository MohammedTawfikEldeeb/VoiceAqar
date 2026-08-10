import { Request, Response } from 'express';
import path from 'node:path';
import { agent, getAgentCallbacks } from '../agent/voiceaqar_agent.js';
import { memoryManager } from '../infrastructure/memory/index.js';
import { getOrCreateUser } from '../utils/user_helper.js';
import { env } from '../config/env.js';

const sessionTTLMs = env.SESSION_TTL_HOURS * 60 * 60 * 1000;

// sessionId -> lastAccessMs. Bounded by the sweeper below (no unbounded growth).
const sessions = new Map<string, number>();

function touchSession(sessionId: string) {
  sessions.set(sessionId, Date.now());
}

function isSessionActive(sessionId: string): boolean {
  const last = sessions.get(sessionId);
  return last !== undefined && Date.now() - last < sessionTTLMs;
}

function startSession(sessionId: string) {
  touchSession(sessionId);
}

// Periodic cleanup of idle chat sessions
const chatSweeper = setInterval(() => {
  const now = Date.now();
  for (const [id, last] of sessions) {
    if (now - last >= sessionTTLMs) sessions.delete(id);
  }
}, 10 * 60 * 1000);
chatSweeper.unref();

/**
 * Handles text-based chat interactions.
 */
export async function handleChat(req: Request, res: Response) {
  try {
    const { message, phoneNumber, sessionId } = req.body;
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    const activeSessionId = sessionId || `sess_${Date.now()}`;
    const activePhone = (phoneNumber || 'unknown_phone').toString().substring(0, 50);

    const { userId, userName } = await getOrCreateUser(activePhone);

    if (!isSessionActive(activeSessionId)) {
      startSession(activeSessionId);
      await memoryManager.onCallStart(activeSessionId, userId);
    } else {
      touchSession(activeSessionId);
    }

    await memoryManager.onUserMessage(activeSessionId, message, userId);

    const contextPrompt = await buildContextPrompt(userId);
    const messages = [
      ...(contextPrompt ? [{ role: 'system', content: contextPrompt }] : []),
      { role: 'user', content: message },
    ];

    const result = await agent.invoke(
      {
        messages
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
    touchSession(activeSessionId);

    res.json({ reply, sessionId: activeSessionId, userId, name: userName });
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
      sessions.delete(sessionId);
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

/**
 * Loads the user's preferences from the knowledge graph so the agent can act
 * on them. Returns undefined when there is no stored context. Failures are
 * tolerated (memory errors must never break the chat).
 */
async function buildContextPrompt(userId: string | undefined): Promise<string | undefined> {
  if (!userId) return undefined;
  try {
    const userContext = await memoryManager.graph.getUserContext(userId);
    if (userContext && userContext.trim() && !userContext.trim().startsWith('No user context')) {
      return `Refer to this info about the user (do not disclose it verbatim):\n${userContext}`;
    }
  } catch (err) {
    console.warn('⚠️ handleChat: failed to load graph context:', err);
  }
  return undefined;
}