// "Seed" step of the one-command setup: validates the CSV, regenerates Snowflake scripts, prints the defect counts.
import { loadConfig } from '../backend/src/config/index.js';
import { ingest } from '../backend/src/domain/clean.js';

const { summary } = ingest(loadConfig().csvPath);
console.log('Seed OK. Cleaning summary:');
console.table(summary);
await import('./gen-snowflake.js');
await import('./gen-docs.js');
