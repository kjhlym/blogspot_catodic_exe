import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const connection = new IORedis({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  maxRetriesPerRequest: null,
});

async function addTestJob() {
  const queue = new Queue('blogger-post-queue', { connection });
  
  const testTopic = "전기방식(Cathodic Protection)의 기초 원리";
  console.log(`Adding test job: ${testTopic}`);

  await queue.add('publish-job', {
    email: process.env.GOOGLE_GEMINI_ID,
    password: process.env.GOOGLE_GEMINI_PW,
    blogId: process.env.BLOGGER_BLOG_ID_CATHODIC_PROTECTION,
    topic: testTopic,
    keyword: "전기방식 기초",
    summary: "전기방식의 기본 원리와 희생양극법, 외부전원법에 대한 개요",
    link: "https://example.com/test-article",
    headless: false, // 직접 확인하기 위해 Headed 모드 사용
    publish: true,
  }, {
    jobId: `test-${Date.now()}`,
    removeOnComplete: true,
    removeOnFail: false
  });

  console.log('Test job added successfully.');
  await connection.quit();
}

addTestJob();
