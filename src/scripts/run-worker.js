import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Blogger RPA Worker (Proxy Runner)
 * 
 * 이 스크립트는 'start-rpa.bat' 또는 'npm run worker' 명령에 의해 호출됩니다.
 * 내부적으로 'src/worker/rpa-worker.ts'를 tsx를 통해 실행합니다.
 */

console.log('==========================================');
console.log(' 🚀 Blogger RPA Worker (Proxy) 시작중...');
console.log('==========================================');

const workerPath = path.join(__dirname, '../worker/rpa-worker.ts');
const command = 'npx';
const args = ['tsx', workerPath];

console.log(`[System] 실행 명령: ${command} ${args.join(' ')}`);

const child = spawn(command, args, {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, NODE_ENV: 'development' }
});

child.on('exit', (code) => {
  if (code !== 0 && code !== null) {
    console.error(`[System] ❌ Worker 프로세스가 비정상 종료되었습니다 (코드: ${code})`);
  } else {
    console.log(`[System] ✅ Worker 프로세스가 정상 종료되었습니다.`);
  }
  process.exit(code || 0);
});

// 프로세스 종료 시 자식 프로세스도 함께 종료되도록 처리
process.on('SIGINT', () => {
  child.kill();
  process.exit();
});

process.on('SIGTERM', () => {
  child.kill();
  process.exit();
});
