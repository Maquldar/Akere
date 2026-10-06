import { buildApp } from './app';
import { config } from './config';
import { prisma } from './lib/db';
import { startJobs, stopJobs } from './jobs';

const app = await buildApp();
await app.listen({ port: config.PORT, host: config.HOST });
if (config.JOBS_ENABLED) await startJobs(app.log);

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    await stopJobs();
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  });
}
