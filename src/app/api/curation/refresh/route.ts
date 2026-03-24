import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import path from 'path';
import { logManager } from '@/lib/log-manager';

export async function POST() {
  try {
    const crawlerPath = path.join(process.cwd(), 'scripts', 'curation-crawler.ts');
    const cmd = `npx tsx "${crawlerPath}"`;

    logManager.broadcast('log', '🔄 [CRAWL] 최신 아티클 수집 시작 (curation-crawler.ts)...');
    logManager.broadcast('status', 'running', { step: 'crawl-start' });

    // 백그라운드에서 실행하고 응답은 즉시 반환하지 않고 결과를 기다립니다 (Express와 동일하게 구현)
    return new Promise((resolve) => {
      exec(cmd, (error, stdout, stderr) => {
        if (error) {
          logManager.broadcast('error', `❌ 수집 중 오류 발생: ${error.message}`);
          resolve(NextResponse.json({ error: error.message }, { status: 500 }));
          return;
        }
        
        logManager.broadcast('log', '✅ [CRAWL] 수집 완료. 데이터베이스가 갱신되었습니다.');
        logManager.broadcast('done', '수집 완료');

        // 처리 완료 후 성공 응답
        resolve(NextResponse.json({ ok: true, message: '수집 완료' }));
      });
    });

  } catch (error) {
    console.error('Refresh API error:', error);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
