import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { BLOGGER_QUEUE_NAME } from '../lib/queue';
import { BloggerBot, BloggerJobData } from '../lib/blogger';
import { Notifier } from '../lib/notifier';
import dotenv from 'dotenv';
import { GeminiBot } from '../lib/gemini';
import { setPublishStatus } from '../lib/status';
import { addHistory } from '../lib/history';

dotenv.config({ path: '.env.local' });

const connection = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  maxRetriesPerRequest: null,
  enableOfflineQueue: false,
};

console.log(`[System] Redis Connection: ${connection.host}:${connection.port}`);
console.log(`[System] Queue Name: ${BLOGGER_QUEUE_NAME}`);

const worker = new Worker(
  BLOGGER_QUEUE_NAME,
  async (job: Job<BloggerJobData>) => {
    console.log(`[Worker] >>> HANDLER START for Job: ${job.id}`);
    
    const jobId = job.id || 'unknown';
    const jobData = { ...job.data };
    const itemLink = jobData.link?.trim();

    // 작업 시작 시 상태를 pending으로 설정 (프론트엔드 동기화용)
    if (itemLink) {
      setPublishStatus(itemLink, 'pending');
    }
    
    try {
      const topicToGenerate = jobData.topic || jobData.keyword;
      console.log(`[Job #${jobId}] Topic to Generate: ${topicToGenerate}`);

      // 1. Gemini를 통한 콘텐츠 생성 (topic이 있고 본문이 없는 경우)
      if (topicToGenerate && (!jobData.title || !jobData.htmlContent)) {
        await Notifier.logStep(jobId, 'GEMINI_GENERATE', `Gemini 콘텐츠 생성 중: ${topicToGenerate}`);
        const gemini = new GeminiBot();
        try {
          const result = await gemini.generate(topicToGenerate, { headless: jobData.headless });
          jobData.title = result.content.title;
          jobData.htmlContent = result.content.html;
          
          if (result.hasImage && result.imagePath) {
            jobData.imagePath = result.imagePath;
          }
          if (!jobData.labels || jobData.labels.length === 0) {
            jobData.labels = result.content.labels;
          }
          await Notifier.logStep(jobId, 'GEMINI_SUCCESS', `Gemini 생성 완료: ${jobData.title}`);
        } catch (err: any) {
          console.error(`[Job #${jobId}] Gemini 에러:`, err.message);
          await Notifier.logStep(jobId, 'GEMINI_ERROR', `Gemini 생성 실패: ${err.message}`);
          if (itemLink) setPublishStatus(itemLink, 'failed');
          throw err;
        } finally {
          await gemini.close();
        }
      }

      // 2. Blogger 포스팅 실행
      await Notifier.logStep(jobId, 'BLOGGER_START', `Blogger 포스팅 시작: ${jobData.title || topicToGenerate}`);
      const bot = new BloggerBot({ headless: jobData.headless });
      try {
        const result = await bot.execute(jobData as any, jobId);
        await Notifier.logStep(jobId, 'SUCCESS', `발행 완료: ${jobData.title}`);
        
        // 히스토리 추가
        if (itemLink) {
          addHistory(itemLink, jobData.title || jobData.keyword);
        }

        // 상태 완료 처리
        if (itemLink) {
          setPublishStatus(itemLink, 'completed');
        }
        
        return result;
      } catch (error: any) {
        console.error(`[Job #${jobId}] Blogger 에러:`, error.message);
        await Notifier.logError(jobId, 'BLOGGER_ERROR', `Blogger 발행 실패`, error);
        
        // 상태 실패 처리
        if (itemLink) {
          setPublishStatus(itemLink, 'failed');
        }
        
        throw error;
      }
    } catch (finalError: any) {
      console.error(`[Job #${jobId}] Worker Fatal Error:`, finalError);
      if (itemLink) {
        setPublishStatus(itemLink, 'failed');
      }
      throw finalError;
    }
  },
  { 
    connection,
    concurrency: 1, // 순차적 처리를 위해 1로 설정
  }
);

worker.on('ready', () => {
  console.log('✅ Worker is ready and connected to Redis');
});

worker.on('error', (err) => {
  console.error('❌ Worker connection error:', err);
});

worker.on('completed', (job) => {
  console.log(`✅ [Job #${job.id}] 최종 완료`);
});

worker.on('failed', (job, err) => {
  console.error(`❌ [Job #${job?.id}] 최종 실패:`, err.message);
});

console.log('🚀 Worker initialized. Waiting for jobs...');
