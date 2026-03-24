import { NextRequest, NextResponse } from 'next/server';
import { logManager } from '@/lib/log-manager';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { addHistory } from '@/lib/history';

interface PublishItem {
  id: string;
  keyword: string;
  title: string;
  topic: string;
  summary: string;
  link: string;
}

export async function POST(req: NextRequest) {
  try {
    const { items, options } = await req.json();

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'No items provided' }, { status: 400 });
    }

    // 백그라운드에서 작업 시작
    startPublishingJob(items, options || {});

    return NextResponse.json({ 
      success: true, 
      message: `${items.length}개 아티클 발행 작업이 시작되었습니다.` 
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

async function startPublishingJob(items: PublishItem[], options: { headless?: boolean }) {
  const rootDir = process.cwd();
  const scriptPath = path.join(rootDir, 'gemini-to-blogger-vibe.js');

  logManager.setAborted(false);
  logManager.broadcast('status', 'running', { message: '발행 작업 시작' });
  
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < items.length; i++) {
    if (logManager.isAborted()) {
      logManager.broadcast('log', '🛑 사용자에 의해 중단되었습니다.');
      break;
    }

    const item = items[i];
    logManager.broadcast('log', `\n[${i + 1}/${items.length}] 📝 아티클 생성 시작: ${item.keyword}`);
    logManager.broadcast('status', 'processing', { 
      current: i + 1, 
      total: items.length, 
      keyword: item.keyword 
    });

    try {
      // 1. article.txt 작성
      const articleContent = `Keyword: ${item.keyword}\nTopic: ${item.topic}\nSummary: ${item.summary}`;
      fs.writeFileSync(path.join(rootDir, 'article.txt'), articleContent, 'utf8');

      // 2. 스크립트 실행 (spawn으로 실시간 스트리밍)
      const args = [scriptPath];
      // 사용자가 브라우저 보기를 선택했거나(options.headless === false), 명시적으로 headless가 아닌 경우
      if (options.headless === true) {
        args.push('--headless');
      } 
      // 기본값은 headed 모드로 실행 (사용자 요청)

      await new Promise<void>((resolve, reject) => {
        const child = spawn('node', args, { cwd: rootDir });

        child.stdout.on('data', (data) => {
          const lines = data.toString().split('\n');
          lines.forEach((line: string) => {
            if (line.trim()) {
              logManager.broadcast('log', `   > ${line.trim()}`);
            }
          });
        });

        child.stderr.on('data', (data) => {
          const lines = data.toString().split('\n');
          lines.forEach((line: string) => {
            if (line.trim() && !line.includes('Debugger attached')) {
              logManager.broadcast('log', `   ⚠ ${line.trim()}`);
            }
          });
        });

        child.on('close', (code) => {
          if (code === 0) {
            logManager.broadcast('log', `   ✅ 발행 성공: ${item.keyword}`);
            // 히스토리에 기록하여 다음 큐레이션 시 제외되도록 함 (제목 포함)
            addHistory(item.link, item.title);
            successCount++;
            resolve();
          } else {
            logManager.broadcast('error', `   ❌ 발행 실패 (코드 ${code}): ${item.keyword}`);
            failCount++;
            resolve(); // 다음 항목 진행을 위해 에러 발생 시에도 resolve
          }
        });

        child.on('error', (err) => {
          logManager.broadcast('error', `   ❌ 실행 오류: ${err.message}`);
          failCount++;
          resolve();
        });

        // 사용자가 중지 버튼을 누를 경우 프로세스 강제 종료
        const checkAbort = setInterval(() => {
          if (logManager.isAborted()) {
            child.kill();
            clearInterval(checkAbort);
          }
        }, 1000);
      });

    } catch (err: any) {
      logManager.broadcast('error', `❌ 예외 발생: ${err.message}`);
      failCount++;
    }
  }

  logManager.broadcast('done', '발행 작업 완료', {
    success: successCount,
    failed: failCount,
    total: items.length
  });
  logManager.broadcast('status', 'idle');
}
