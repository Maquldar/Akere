import { PgBoss } from 'pg-boss';
import type { FastifyBaseLogger } from 'fastify';
import { config } from '../config';

/**
 * Background jobs on pg-boss. Modules register handlers with registerJob(); schedules use cron.
 * In tests jobs are not started; job functions are called directly.
 */
type Handler = () => Promise<void>;
const jobs: { name: string; cron: string; handler: Handler }[] = [];
let boss: PgBoss | null = null;

export function registerJob(name: string, cron: string, handler: Handler) {
  jobs.push({ name, cron, handler });
}

export async function startJobs(log: FastifyBaseLogger) {
  if (jobs.length === 0) return;
  boss = new PgBoss(config.DATABASE_URL);
  boss.on('error', (e) => log.error(e, 'pg-boss error'));
  await boss.start();
  for (const j of jobs) {
    await boss.createQueue(j.name);
    await boss.schedule(j.name, j.cron, null, { tz: 'Asia/Almaty' });
    await boss.work(j.name, async () => {
      try {
        await j.handler();
      } catch (e) {
        log.error(e, `job ${j.name} failed`);
        throw e;
      }
    });
  }
  log.info(`jobs started: ${jobs.map((j) => j.name).join(', ')}`);
}

export async function stopJobs() {
  await boss?.stop({ graceful: true });
}

export const registeredJobs = () => jobs;
