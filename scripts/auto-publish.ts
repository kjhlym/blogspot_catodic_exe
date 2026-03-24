import fs from 'fs';
import path from 'path';
import { exec, spawn } from 'child_process';
import util from 'util';
import { filterNewItems, addHistory } from '../src/lib/history';

const execAsync = util.promisify(exec);

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 실시간 로그 출력을 위한 개별 프로세스 실행 함수
async function runScriptWithLogs(command: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const childProcess = spawn(command, args, { cwd, shell: true });
    let output = '';

    childProcess.stdout.on('data', (data) => {
      const str = data.toString();
      output += str;
      process.stdout.write(data); // 부모 프로세스의 stdout으로 그대로 전달 (실시간)
    });

    childProcess.stderr.on('data', (data) => {
      process.stderr.write(data);
    });

    childProcess.on('close', (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(`Process exited with code ${code}`));
    });
  });
}

async function runAutoPublish() {
  console.log('🤖 [AUTO] 완전 무인 자동 발행 스크스크립트를 시작합니다!');

  // 1. 크롤러 실행하여 최신 DB 구축
  console.log('\n=======================================');
  console.log('🤖 [1단계] 크롤러 실행 중...');
  try {
    const { stdout, stderr } = await execAsync('npx tsx scripts/curation-crawler.ts');
    console.log(stdout);
    if(stderr) console.error(stderr);
  } catch (err) {
    console.error('크롤러 실행 중 오류 발생:', err);
    return;
  }

  // 2. DB 읽기
  console.log('\n=======================================');
  console.log('🤖 [2단계] 생성된 로컬 DB에서 발간할 새 글감 추출 중...');
  const dbPath = path.join(process.cwd(), 'data', 'curation-db.json');
  if (!fs.existsSync(dbPath)) {
    console.error('curation-db.json 파일을 찾을 수 없습니다.');
    return;
  }

  const dbData = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
  
  let allItems: any[] = [];
  for (const key in dbData) {
    if (dbData[key] && dbData[key].items) {
      allItems = allItems.concat(dbData[key].items);
    }
  }

  // 3. 중복 (이미 발행된) 항목 제거
  const newItems = filterNewItems(allItems);
  console.log(`🤖 수집된 총 ${allItems.length}개 항목 중, 새로 발행할 항목은 ${newItems.length}개 입니다.`);

  if (newItems.length === 0) {
    console.log('🤖 발행할 새 항목이 없습니다. 스크립트를 종료합니다.');
    return;
  }

  // 4. 순차적 발행
  console.log('\n=======================================');
  console.log('🤖 [3단계] 순차적 자동 발행 시작...');
  const rootDir = process.cwd();
  const articlePath = path.join(rootDir, 'article.txt');

  for (let i = 0; i < newItems.length; i++) {
    const item = newItems[i];
    console.log(`\n▶ [${i+1}/${newItems.length}] 발행 중: ${item.title}`);
    
    try {
      const content = `[카테고리]: ${item.category || '뉴스'}\n[주제/제목]: ${item.title}\n[원본 링크]: ${item.link}\n[요약 설명]: ${item.description}\n\n위의 글감(주제, 링크, 요약 설명) 내용을 바탕으로 구체적인 살을 붙여 정보성 블로그 포스팅 초본을 완성해줘.`;
      fs.writeFileSync(articlePath, content, 'utf-8');

      console.log(`🤖 Gemini AI 포스팅 작성 및 Blogger 등록 중... (실시간 로그 출력 예정)`);
      
      // exec 대신 spawn 기반의 runScriptWithLogs 사용
      const stdout = await runScriptWithLogs('node', ['gemini-to-blogger-vibe.js'], rootDir);
      
      console.log(`🤖 성공: ${stdout.substring(stdout.length - 200).trim()}`);
      
      addHistory(item.link);

      if (i < newItems.length - 1) {
        console.log('🤖 과부하 및 IP 차단 방지를 위해 30초 대기 중...');
        await sleep(30000);
      }
    } catch (err: any) {
      console.error(`🤖 오류 발생 (${item.title}):`, err.message || err);
    }
  }

  console.log('\n=======================================');
  console.log('🎉 모든 자동 발행 작업이 완료되었습니다!');
}

runAutoPublish().catch(console.error);
