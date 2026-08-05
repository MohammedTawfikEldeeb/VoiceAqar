export interface UserPreference {
  type: string;   
  value: string;  
}

export interface UserBudget {
  min: number;
  max: number;
  currency: string; 
}

export interface PropertyInteraction {
  propertyId: string;
  interactionType: 'viewed' | 'liked' | 'inquired' | 'called';
  timestamp: Date;
}

export interface IGraphMemoryService {
  initialize(): Promise<void>;
  upsertUser(userId: string, metadata?: Record<string, string>): Promise<void>;
  addPreference(userId: string, preferenceType: string, value: string): Promise<void>;
  setBudget(userId: string, min: number, max: number, currency?: string): Promise<void>;
  addSearchHistory(userId: string, query: string, timestamp?: Date): Promise<void>;
  addPropertyInteraction(userId: string, propertyId: string, interactionType: string): Promise<void>;
  getUserPreferences(userId: string): Promise<UserPreference[]>;
  getUserBudget(userId: string): Promise<UserBudget | null>;
  getUserContext(userId: string): Promise<string>;
  clearUserPreferences(userId: string): Promise<void>;
}

export default IGraphMemoryService;
