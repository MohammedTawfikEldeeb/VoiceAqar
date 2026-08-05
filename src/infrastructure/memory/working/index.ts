import { RedisWorkingMemoryService } from './providers/redis.js';
import type { IWorkingMemoryService } from './interface.js';

export class WorkingMemoryFactory {
  static create(): IWorkingMemoryService {
    return new RedisWorkingMemoryService();
  }
}

export const workingMemory = WorkingMemoryFactory.create();
export default workingMemory;
