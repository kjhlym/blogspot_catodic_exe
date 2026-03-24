import { logManager } from '@/lib/log-manager';

export const dynamic = 'force-dynamic';

export async function GET() {
  const stream = new ReadableStream({
    start(controller) {
      logManager.registerClient(controller);
    },
    cancel() {
      // 클라이언트가 연결을 끊었을 때 처리할 로직 (필요시)
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
