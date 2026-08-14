import { pool } from '../config/db.js';
import { graphDriver } from '../config/graph.js';
import { redis } from '../config/redis.js';

async function clearAllDatabases() {
  console.log('══════════════════════════════════════════════════');
  console.log(' STARTING TOTAL DATABASE HISTORY WIPE...');
  console.log('══════════════════════════════════════════════════\n');

  // 1. Clear PostgreSQL users & LangGraph checkpoints
  console.log('⏳ 1. Clearing PostgreSQL data...');
  const pgClient = await pool.connect();
  try {
    // Truncate LangGraph checkpoint tables
    await pgClient.query('TRUNCATE TABLE checkpoints CASCADE;');
    await pgClient.query('TRUNCATE TABLE checkpoint_writes CASCADE;');
    await pgClient.query('TRUNCATE TABLE checkpoint_blobs CASCADE;');
    await pgClient.query('TRUNCATE TABLE checkpoint_metadata CASCADE;');
    
    // Truncate users table
    await pgClient.query('TRUNCATE TABLE users CASCADE;');
    console.log('✔ PostgreSQL checkpoint tables and users table successfully truncated!');
  } catch (pgErr: any) {
    console.warn('⚠ PostgreSQL truncate warning (tables might not exist yet):', pgErr.message || pgErr);
  } finally {
    pgClient.release();
  }

  // 2. Clear Neo4j Knowledge Graph
  console.log('⏳ 2. Clearing Neo4j Knowledge Graph...');
  const neoSession = graphDriver.session();
  try {
    await neoSession.executeWrite((tx) => tx.run('MATCH (n) DETACH DELETE n'));
    console.log('✔ Neo4j knowledge graph nodes and relationships successfully deleted!');
  } catch (neoErr: any) {
    console.warn('⚠ Neo4j delete warning:', neoErr.message || neoErr);
  } finally {
    await neoSession.close();
  }

  // 3. Clear Redis Caches
  console.log('⏳ 3. Clearing Redis...');
  try {
    await redis.flushAll();
    console.log('✔ Redis cache successfully flushed!');
  } catch (redisErr: any) {
    console.warn('⚠ Redis flush warning:', redisErr.message || redisErr);
  }

  console.log('\n══════════════════════════════════════════════════');
  console.log('✔ WIPE COMPLETED SUCCESSFULLY!');
  console.log('══════════════════════════════════════════════════');

  // Disconnect clients to close process
  await graphDriver.close();
  await redis.disconnect();
  await pool.end();
  process.exit(0);
}

clearAllDatabases().catch((err) => {
  console.error('❌ Critical error during database history wipe:', err);
  process.exit(1);
});
