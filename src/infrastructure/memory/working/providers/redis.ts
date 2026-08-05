import { redis } from '../../../../config/redis.js';
import type { IWorkingMemoryService } from '../interface.js';
import type { Redis } from 'ioredis';

export class RedisWorkingMemoryService implements IWorkingMemoryService {
  private redisClient: Redis;
  private defaultTtl: number;
  private maxTurns: number;

  constructor(redisClient: Redis = redis, defaultTtl: number = 3600, maxTurns: number = 20) {
    this.redisClient = redisClient;
    this.defaultTtl = defaultTtl;
    this.maxTurns = maxTurns;
  }

  private getSessionKey(sessionId: string) {
    return `voiceaqar:session:${sessionId}`;
  }

  private getTurnsKey(sessionId: string) {
    return `voiceaqar:session:${sessionId}:turns`;
  }

  private getBargeInKey(sessionId: string) {
    return `voiceaqar:session:${sessionId}:bargein`;
  }

  private getAudioBufferKey(sessionId: string) {
    return `voiceaqar:session:${sessionId}:audiobuf`;
  }

  async createSession(sessionId: string, metadata?: Record<string, string>): Promise<void> {
    const key = this.getSessionKey(sessionId);
    const data = metadata && Object.keys(metadata).length > 0 ? metadata : { created_at: Date.now().toString() };
    await this.redisClient.hset(key, data);
    await this.redisClient.expire(key, this.defaultTtl);
  }

  async getSession(sessionId: string): Promise<Record<string, string> | null> {
    const key = this.getSessionKey(sessionId);
    const session = await this.redisClient.hgetall(key);
    return Object.keys(session).length > 0 ? session : null;
  }

  async updateSession(sessionId: string, patch: Record<string, string>): Promise<void> {
    const key = this.getSessionKey(sessionId);
    if (Object.keys(patch).length > 0) {
      await this.redisClient.hset(key, patch);
      await this.redisClient.expire(key, this.defaultTtl);
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    const multi = this.redisClient.multi();
    multi.del(this.getSessionKey(sessionId));
    multi.del(this.getTurnsKey(sessionId));
    multi.del(this.getBargeInKey(sessionId));
    multi.del(this.getAudioBufferKey(sessionId));
    await multi.exec();
  }

  async setBargeIn(sessionId: string, active: boolean): Promise<void> {
    const key = this.getBargeInKey(sessionId);
    await this.redisClient.set(key, active ? '1' : '0', 'EX', this.defaultTtl);
  }

  async getBargeIn(sessionId: string): Promise<boolean> {
    const val = await this.redisClient.get(this.getBargeInKey(sessionId));
    return val === '1';
  }

  async pushTurn(sessionId: string, role: 'user' | 'model' | 'tool', content: string): Promise<void> {
    const key = this.getTurnsKey(sessionId);
    const turn = JSON.stringify({ role, content });
    await this.redisClient.rpush(key, turn);
    await this.redisClient.ltrim(key, -this.maxTurns, -1);
    await this.redisClient.expire(key, this.defaultTtl);
  }

  async getRecentTurns(sessionId: string, count: number = this.maxTurns): Promise<Array<{ role: string; content: string }>> {
    const key = this.getTurnsKey(sessionId);
    const items = await this.redisClient.lrange(key, -count, -1);
    return items.map(item => JSON.parse(item));
  }

  async setAudioBufferFlag(sessionId: string, flag: boolean): Promise<void> {
    const key = this.getAudioBufferKey(sessionId);
    await this.redisClient.set(key, flag ? '1' : '0', 'EX', this.defaultTtl);
  }

  async getAudioBufferFlag(sessionId: string): Promise<boolean> {
    const val = await this.redisClient.get(this.getAudioBufferKey(sessionId));
    return val === '1';
  }
}

export default RedisWorkingMemoryService;
