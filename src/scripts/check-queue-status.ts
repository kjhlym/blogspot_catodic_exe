import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';

const connection = new IORedis({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  maxRetriesPerRequest: null,
});

async function checkQueue() {
  console.log('Checking BullMQ Queue...');
  const queue = new Queue('blogger-post-queue', { connection });
  
  try {
    const jobCounts = await queue.getJobCounts();
    console.log('Current Job Counts:', jobCounts);

    const activeJobs = await queue.getActive();
    console.log(`Active Jobs: ${activeJobs.length}`);
    activeJobs.forEach(job => {
        console.log(` - ID: ${job.id}, Data:`, job.data.topic);
    });

    const waitingJobs = await queue.getWaiting();
    console.log(`Waiting Jobs: ${waitingJobs.length}`);

    const failedJobs = await queue.getFailed();
    console.log(`Failed Jobs (last 5):`);
    failedJobs.slice(-5).forEach(job => {
        console.log(` - ID: ${job.id}, Reason: ${job.failedReason}`);
    });

  } catch (err) {
    console.error('Error checking queue:', err);
  } finally {
    await connection.quit();
  }
}

checkQueue();
