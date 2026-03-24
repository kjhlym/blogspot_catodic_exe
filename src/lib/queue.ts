import { Queue } from 'bullmq';

// Redis 연결 설정 (Windows 로컬 Redis 기본값: 6379)
// ioredis 인스턴스 대신 설정 객체를 전달하여 타입 충돌 방지 및 안전한 연결 관리
const connection = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  maxRetriesPerRequest: null, // BullMQ 권장 설정
  enableOfflineQueue: false,  // Redis 오프라인 시 명령 대기 방지 (지연 방지)
  retryStrategy(times: number) {
    // 3회까지만 재시도 후 포기하여 API 응답 지연 방지
    if (times > 3) {
      console.warn(`[Redis] Retry limit reached (${times}). Connection giving up.`);
      return null;
    }
    return Math.min(times * 100, 1000);
  },
};

export const BLOGGER_QUEUE_NAME = 'blogger-post-queue';

// 큐 인스턴스 초기화
export const bloggerQueue = new Queue(BLOGGER_QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    attempts: 3, // 실패 시 3회 재시도
    backoff: {
      type: 'exponential',
      delay: 5000, // 5초부터 지수 백오프
    },
    removeOnComplete: true, // 완료 시 큐에서 제거
    removeOnFail: false,   // 실패 시 로그 확인을 위해 유지
  },
});

export default bloggerQueue;
