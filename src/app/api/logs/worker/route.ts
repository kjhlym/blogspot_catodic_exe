import { NextRequest, NextResponse } from 'next/server';
import { logManager } from '@/lib/log-manager';

/**
 * 워커 프로세스에서 대시보드로 로그를 전송하기 위한 엔드포인트
 */
export async function POST(req: NextRequest) {
  try {
    const { jobId, step, message, type = 'info' } = await req.json();

    if (!message) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    const logMessage = jobId ? `[Job #${jobId}] [${step || 'SYSTEM'}] ${message}` : message;

    // logManager를 통해 SSE 스트림으로 브로드캐스트
    const logType: any = type === 'error' ? 'error' : 'log';
    logManager.broadcast(logType, logMessage);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in worker log API:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
