export interface IWorkingMemoryService {
  createSession(sessionId: string, metadata?: Record<string, string>): Promise<void>;
  getSession(sessionId: string): Promise<Record<string, string> | null>;
  updateSession(sessionId: string, patch: Record<string, string>): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
  setBargeIn(sessionId: string, active: boolean): Promise<void>;
  getBargeIn(sessionId: string): Promise<boolean>;
  pushTurn(sessionId: string, role: 'user' | 'model' | 'tool', content: string): Promise<void>;
  getRecentTurns(sessionId: string, count?: number): Promise<Array<{ role: string; content: string }>>;
  setAudioBufferFlag(sessionId: string, flag: boolean): Promise<void>;
  getAudioBufferFlag(sessionId: string): Promise<boolean>;
}

export default IWorkingMemoryService;
