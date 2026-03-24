const { spawn } = require('child_process');
const path = require('path');

console.log('--- Blogger RPA Worker Runner ---');

// ts-node를 사용하여 직접 실행하거나, 혹은 npx로 실행
const workerPath = path.join(__dirname, '../worker/rpa-worker.ts');
const command = 'npx';
const args = ['tsx', workerPath];

console.log(`Command: ${command} ${args.join(' ')}`);

const child = spawn(command, args, {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, NODE_ENV: 'development' }
});

child.on('exit', (code) => {
  console.log(`Worker exited with code ${code}`);
  process.exit(code);
});
