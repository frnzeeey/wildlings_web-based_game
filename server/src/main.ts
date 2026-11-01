import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './server.ts';
import { log } from './log.ts';

const here = dirname(fileURLToPath(import.meta.url));
const env = process.env;

const { close } = await startServer({
  port: Number(env.PORT ?? 8787),
  host: env.HOST ?? '0.0.0.0',
  dbPath: env.DB_PATH ?? join(here, '../data/wildlings.db'),
  migrationsDir: join(here, '../migrations'),
  staticDir: env.STATIC_DIR ?? join(here, '../../web/dist'),
  corsOrigin: env.CORS_ORIGIN,
  reconnectGraceMs: env.RECONNECT_GRACE ? Number(env.RECONNECT_GRACE) * 1000 : undefined,
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    log.info(`${sig}: shutting down`);
    await close();
    process.exit(0);
  });
}
