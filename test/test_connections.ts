import { db } from '../src/config/db.js';
import { sql } from 'drizzle-orm';
import { redis } from '../src/config/redis.js';
import { graphDriver } from '../src/config/graph.js';
import { qdrant } from '../src/config/qdrant.js';

async function testConnections() {
  console.log('🔍 Testing client connections...\n');
  let allPassed = true;

  // 1. PostgreSQL (Drizzle)
  try {
    await db.execute(sql`SELECT 1;`);
    console.log('✅ PostgreSQL (Drizzle) connection: SUCCESS');
  } catch (error) {
    console.error('❌ PostgreSQL (Drizzle) connection: FAILED');
    console.error(error);
    allPassed = false;
  }

  // 2. Redis (ioredis)
  try {
    const pong = await redis.ping();
    if (pong === 'PONG') {
      console.log('✅ Redis (ioredis) connection: SUCCESS');
    } else {
      throw new Error(`Unexpected Redis ping response: ${pong}`);
    }
  } catch (error) {
    console.error('❌ Redis (ioredis) connection: FAILED');
    console.error(error);
    allPassed = false;
  } finally {
    await redis.quit();
  }

  // 3. Neo4j (graphDriver)
  try {
    const serverInfo = await graphDriver.getServerInfo();
    console.log(`✅ Neo4j connection: SUCCESS (Address: ${serverInfo.address}, Agent: ${serverInfo.agent})`);
  } catch (error) {
    console.error('❌ Neo4j connection: FAILED');
    console.error(error);
    allPassed = false;
  } finally {
    await graphDriver.close();
  }

  // 4. Qdrant
  try {
    await qdrant.getCollections();
    console.log('✅ Qdrant connection: SUCCESS');
  } catch (error) {
    console.error('❌ Qdrant connection: FAILED');
    console.error(error);
    allPassed = false;
  }

  console.log('\n----------------------------------------');
  if (allPassed) {
    console.log('🎉 All client connections tested successfully!');
    process.exit(0);
  } else {
    console.error('🚨 One or more connections failed. Please check the logs.');
    process.exit(1);
  }
}

testConnections();
