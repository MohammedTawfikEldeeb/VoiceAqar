import { graphDriver } from '../../../../config/graph.js';
import {
  IGraphMemoryService,
  UserPreference,
  UserBudget,
  PropertyInteraction,
} from '../interface.js';

export class Neo4jGraphMemoryService implements IGraphMemoryService {
  async initialize(): Promise<void> {
    const session = graphDriver.session();
    try {
      await session.executeWrite((tx) =>
        tx.run('CREATE CONSTRAINT user_id_unique IF NOT EXISTS FOR (u:User) REQUIRE u.userId IS UNIQUE')
      );
    } finally {
      await session.close();
    }
  }

  async upsertUser(userId: string, metadata?: Record<string, string>): Promise<void> {
    const session = graphDriver.session();
    try {
      await session.executeWrite((tx) =>
        tx.run(
          `
          MERGE (u:User {userId: $userId})
          SET u += $metadata
          `,
          { userId, metadata: metadata || {} }
        )
      );
    } finally {
      await session.close();
    }
  }

  async addPreference(userId: string, preferenceType: string, value: string): Promise<void> {
    const session = graphDriver.session();
    try {
      await session.executeWrite((tx) =>
        tx.run(
          `
          MERGE (u:User {userId: $userId})
          MERGE (e:\`${preferenceType}\` {name: $value})
          MERGE (u)-[r:PREFERS {type: $preferenceType}]->(e)
          `,
          { userId, preferenceType, value }
        )
      );
    } finally {
      await session.close();
    }
  }

  async setBudget(userId: string, min: number, max: number, currency: string = 'EGP'): Promise<void> {
    const session = graphDriver.session();
    try {
      await session.executeWrite((tx) =>
        tx.run(
          `
          MERGE (u:User {userId: $userId})
          MERGE (b:BudgetRange {userId: $userId})
          SET b.min = $min, b.max = $max, b.currency = $currency
          MERGE (u)-[:HAS_BUDGET]->(b)
          `,
          { userId, min, max, currency }
        )
      );
    } finally {
      await session.close();
    }
  }

  async addSearchHistory(userId: string, query: string, timestamp?: Date): Promise<void> {
    const session = graphDriver.session();
    try {
      await session.executeWrite((tx) =>
        tx.run(
          `
          MERGE (u:User {userId: $userId})
          CREATE (s:SearchEvent {query: $query, timestamp: datetime($timestamp)})
          CREATE (u)-[:SEARCHED]->(s)
          `,
          { userId, query, timestamp: timestamp ? timestamp.toISOString() : new Date().toISOString() }
        )
      );
    } finally {
      await session.close();
    }
  }

  async addPropertyInteraction(userId: string, propertyId: string, interactionType: string): Promise<void> {
    const session = graphDriver.session();
    try {
      await session.executeWrite((tx) =>
        tx.run(
          `
          MERGE (u:User {userId: $userId})
          MERGE (p:Property {propertyId: $propertyId})
          MERGE (u)-[r:INTERACTED {type: $interactionType}]->(p)
          SET r.timestamp = datetime()
          `,
          { userId, propertyId, interactionType }
        )
      );
    } finally {
      await session.close();
    }
  }

  async getUserPreferences(userId: string): Promise<UserPreference[]> {
    const session = graphDriver.session();
    try {
      const result = await session.executeRead((tx) =>
        tx.run(
          `
          MATCH (u:User {userId: $userId})-[r:PREFERS]->(e)
          RETURN e.name as value, labels(e)[0] as type
          `,
          { userId }
        )
      );

      return result.records.map((record) => ({
        type: record.get('type'),
        value: record.get('value'),
      }));
    } finally {
      await session.close();
    }
  }

  async getUserBudget(userId: string): Promise<UserBudget | null> {
    const session = graphDriver.session();
    try {
      const result = await session.executeRead((tx) =>
        tx.run(
          `
          MATCH (u:User {userId: $userId})-[:HAS_BUDGET]->(b:BudgetRange)
          RETURN b.min as min, b.max as max, b.currency as currency
          `,
          { userId }
        )
      );

      if (result.records.length === 0) {
        return null;
      }

      const record = result.records[0];
      return {
        min: record.get('min'),
        max: record.get('max'),
        currency: record.get('currency'),
      };
    } finally {
      await session.close();
    }
  }

  async getUserContext(userId: string): Promise<string> {
    const session = graphDriver.session();
    try {
      const result = await session.executeRead((tx) =>
        tx.run(
          `
          MATCH (u:User {userId: $userId})
          OPTIONAL MATCH (u)-[:PREFERS]->(e)
          WITH u, collect({type: labels(e)[0], value: e.name}) as prefs
          OPTIONAL MATCH (u)-[:HAS_BUDGET]->(b:BudgetRange)
          WITH u, prefs, b
          OPTIONAL MATCH (u)-[:SEARCHED]->(s:SearchEvent)
          WITH prefs, b, s ORDER BY s.timestamp DESC LIMIT 5
          RETURN prefs, b, collect(s.query) as recentSearches
          `,
          { userId }
        )
      );

      if (result.records.length === 0) {
        return 'No user context available.';
      }

      const record = result.records[0];
      const prefs = record.get('prefs') || [];
      const budget = record.get('b');
      const recentSearches = record.get('recentSearches') || [];

      const districts = prefs.filter((p: any) => p.type === 'District' || p.type === 'district').map((p: any) => p.value).filter(Boolean);
      const propertyTypes = prefs.filter((p: any) => p.type === 'PropertyType' || p.type === 'propertyType').map((p: any) => p.value).filter(Boolean);

      let contextStr = 'User Preferences:\n';
      
      if (districts.length > 0) {
        contextStr += `- Preferred districts: ${districts.join(', ')}\n`;
      }
      if (propertyTypes.length > 0) {
        contextStr += `- Preferred property type: ${propertyTypes.join(', ')}\n`;
      }
      if (budget) {
        contextStr += `- Budget: ${budget.properties?.min || budget.min || ''} - ${budget.properties?.max || budget.max || ''} ${budget.properties?.currency || budget.currency || 'EGP'}\n`;
      }
      if (recentSearches.length > 0) {
        contextStr += `- Recent searches: ${recentSearches.join(', ')}\n`;
      }

      return contextStr.trim();
    } finally {
      await session.close();
    }
  }

  async clearUserPreferences(userId: string): Promise<void> {
    const session = graphDriver.session();
    try {
      await session.executeWrite((tx) =>
        tx.run(
          `
          MATCH (u:User {userId: $userId})-[r:PREFERS]->()
          DELETE r
          `,
          { userId }
        )
      );
    } finally {
      await session.close();
    }
  }
}

export default Neo4jGraphMemoryService;
