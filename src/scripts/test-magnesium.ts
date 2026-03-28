import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const connection = new IORedis({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  maxRetriesPerRequest: null,
});

async function runMagnesiumTest() {
  const queue = new Queue('blogger-post-queue', { connection });
  console.log('Adding New Topic Job: Magnesium Anode Design');
  
  try {
    const testTopic = "전기방식용 마그네슘 양극(Magnesium Anode)의 설계 및 설치 가이드";
    await queue.add('publish-job', {
      email: process.env.GOOGLE_GEMINI_ID,
      password: process.env.GOOGLE_GEMINI_PW,
      blogId: process.env.BLOGGER_BLOG_ID_CATHODIC_PROTECTION,
      topic: testTopic,
      keyword: "마그네슘 양극",
      summary: "희생양극법의 핵심인 마그네슘 양극의 특성, 설계 계산 및 토양 내 설치 시 주의사항에 대해 상세히 설명합니다.",
      link: "https://example.com/magnesium-test",
      headless: false,
      publish: true,
    }, {
      jobId: `magnesium-${Date.now()}`,
    });
    console.log('Magnesium Anode test job added.');

  } catch (err) {
    console.error('Error adding job:', err);
  } finally {
    await connection.quit();
  }
}

runMagnesiumTest();
