const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");

async function postToTistory(title, htmlContent, thumbnailPath) {
  const email = process.env.TISTORY_EMAIL;
  const password = process.env.TISTORY_PASSWORD;
  const blogUrl = process.env.TISTORY_BLOG_URL;

  if (!email || !password || !blogUrl) {
    throw new Error("환경 변수에 Tistory 로그인 정보나 블로그 URL이 없습니다.");
  }

  // Create a temporary data file to pass to the worker
  const tempId = Date.now().toString();
  const dataPath = path.join(process.cwd(), `tmp_tistory_data_${tempId}.json`);
  
  fs.writeFileSync(dataPath, JSON.stringify({
    email,
    password,
    blogUrl,
    title,
    htmlContent,
    thumbnailPath
  }));

  const workerScript = path.join(process.cwd(), "src", "scripts", "playwright-worker.js");

  return new Promise((resolve, reject) => {
    // Spawn the worker process
    const child = exec(`node "${workerScript}" "${dataPath}"`, { windowsHide: true }, (error, stdout, stderr) => {
      // Clean up temp file
      try {
        if (fs.existsSync(dataPath)) fs.unlinkSync(dataPath);
      } catch(e) {}

      if (error) {
        console.error("Worker error:", stderr || error.message);
        reject(new Error(`Tistory 포스팅 워커 에러: ${stderr || error.message}`));
      } else {
        console.log("Worker output:", stdout);
        resolve();
      }
    });
    
    // Log realtime output
    if (child.stdout) child.stdout.on('data', (data) => process.stdout.write(data));
    if (child.stderr) child.stderr.on('data', (data) => process.stderr.write(data));
  });
}

module.exports = { postToTistory };
