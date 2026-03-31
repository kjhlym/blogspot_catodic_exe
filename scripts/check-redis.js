import { execSync } from 'child_process';

/**
 * Redis (Memurai) 서비스 상태를 확인하고 꺼져 있으면 시작합니다.
 */
function checkRedis() {
  console.log('[*] Checking Redis (Memurai) status...');
  try {
    const output = execSync('net start').toString();
    if (output.includes('Memurai')) {
      console.log('[+] Redis (Memurai) is already running.');
    } else {
      console.log('[!] Redis (Memurai) is NOT running. Starting...');
      execSync('net start Memurai', { stdio: 'inherit' });
      console.log('[+] Redis (Memurai) started successfully.');
    }
  } catch (error) {
    console.error('[!] Error checking or starting Redis:', (error instanceof Error ? error.message : String(error)));
    console.log('[!] Please make sure you have administrative privileges if Redis needs to be started.');
  }
}

checkRedis();
