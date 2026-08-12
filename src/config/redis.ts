import { Redis } from 'ioredis';
import { env } from './env.js';

export const redis = new Redis(env.REDIS_URL);

redis.on('connect', () => {
  console.log(' Connected to Redis successfully');
});

redis.on('error', (err) => {
  console.error(' Redis Connection Error:', err);
});