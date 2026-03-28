import { BloggerBot, BloggerJobData } from '../lib/blogger';
import fs from 'fs';
import path from 'path';

async function main() {
  const dataPath = process.argv[2];
  if (!dataPath) {
    console.error("No data path provided.");
    process.exit(1);
  }

  const dataString = fs.readFileSync(dataPath, 'utf-8');
  const data = JSON.parse(dataString) as BloggerJobData & { email?: string; password?: string };
  
  const bot = new BloggerBot();
  const jobId = `bot-${Date.now()}`;

  try {
    console.log(`[Executor] Starting BloggerBot for: ${data.title}`);
    const result = await bot.execute(data, jobId);
    
    // 이중 로그 방지 및 호환성 유지
    console.log(`[WorkerResult] ${JSON.stringify({
      success: true,
      postId: result.url ? result.url.split('/').pop() : '',
      url: result.url,
      title: data.title
    })}`);
    
    process.exit(0);
  } catch (err: any) {
    console.error(`[Executor Error] ${err.message}`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
