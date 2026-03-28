import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const connection = new IORedis({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  maxRetriesPerRequest: null,
});

async function runStrayCurrentTest() {
  const queue = new Queue('blogger-post-queue', { connection });
  console.log('Adding New Topic Job: Stray Current Interference');
  
  try {
    const testTopic = "전기방식(Cathodic Protection)의 복병: 미귀환 전류(Stray Current) 간섭과 배관 부식 방지 대책";
    await queue.add('publish-job', {
      email: process.env.GOOGLE_GEMINI_ID,
      password: process.env.GOOGLE_GEMINI_PW,
      blogId: process.env.BLOGGER_BLOG_ID_CATHODIC_PROTECTION,
      topic: testTopic,
      keyword: "미귀환 전류 부식",
      summary: "미귀환 전류(Stray Current)에 의한 배관 부식의 원인과 이를 방지하기 위한 능동형/수동형 방지 대책에 대해 다룹니다.",
      link: "https://example.com/stray-current-test",
      headless: false,
      publish: true,
    }, {
      jobId: `stray-current-${Date.now()}`,
    });
    console.log('Stray Current test job added.');

  } catch (err) {
    console.error('Error adding job:', err);
  } finally {
    await connection.quit();
  }
}

runStrayCurrentTest();
