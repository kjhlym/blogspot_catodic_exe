import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { BLOGGER_QUEUE_NAME } from '../lib/queue';
import { BloggerBot, BloggerJobData } from '../lib/blogger';
import { Notifier } from '../lib/notifier';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const connection = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  maxRetriesPerRequest: null,
  enableOfflineQueue: false,
};

console.log('🚀 Blogger RPA Worker 시작됨...');

const worker = new Worker(
  BLOGGER_QUEUE_NAME,
  async (job: Job<BloggerJobData>) => {
    console.log(`[Job #${job.id}] 처리 중: ${job.data.title}`);
    const bot = new BloggerBot();
    try {
      return await bot.execute(job.data, job.id || 'unknown');
    } catch (error: any) {
      console.error(`[Job #${job.id}] 에러 발생:`, error.message);
      throw error;
    }
  },
  { 
    connection,
    concurrency: 1, // 순차적 처리를 위해 1로 설정 (Blogger 중복 로그인 방지)
  }
);

worker.on('completed', (job) => {
  console.log(`✅ [Job #${job.id}] 완료`);
});

worker.on('failed', (job, err) => {
  console.error(`❌ [Job #${job?.id}] 실패:`, err.message);
});
