import { PostgresRelationalMemoryService } from './providers/postgres.js';
import type { IRelationalMemoryService } from './interface.js';

export class RelationalMemoryFactory {
  static create(): IRelationalMemoryService {
    return new PostgresRelationalMemoryService();
  }
}

export const relationalMemory = RelationalMemoryFactory.create();
export default relationalMemory;
