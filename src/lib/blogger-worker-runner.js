const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const bloggerApi = require("./blogger-api.js");

function getGoogleCredentials() {
  const email = process.env.GOOGLE_GEMINI_ID?.trim();
  const password = process.env.GOOGLE_GEMINI_PW?.trim();

  if (!email || !password) {
    throw new Error("Blogger 에디터 워커 실행에 필요한 GOOGLE_GEMINI_ID / GOOGLE_GEMINI_PW가 없습니다.");
  }

  return { email, password };
}

function parseWorkerResult(output) {
  const text = String(output || "");
  const matches = Array.from(text.matchAll(/\[WorkerResult\]\s+({.*})/g));
  if (matches.length === 0) {
    return null;
  }

  try {
    return JSON.parse(matches[matches.length - 1][1]);
  } catch {
    return null;
  }
}

async function enrichWithApiData(result, { blogId, labels, customMetaData, publish }) {
  let enriched = {
    ...result,
    blogId: String(blogId)
  };

  // UI 자동화(워커)가 완벽히 동작하므로 Blogger REST API (OAuth) 호출을 비활성화합니다.
  // 이로 인해 401 Invalid Client (토큰 갱신 실패) 에러가 더 이상 발생하지 않습니다.
  /*
  if (!enriched.postId || !bloggerApi.isBloggerApiConfigured()) {
    return enriched;
  }

  if ((Array.isArray(labels) && labels.length > 0) || customMetaData) {
    try {
      await bloggerApi.patchPost({
        blogId,
        postId: enriched.postId,
        patch: {
          labels: Array.isArray(labels) && labels.length > 0 ? labels : undefined,
          customMetaData
        },
        publish: publish === false ? undefined : true
      });
    } catch (e) {
      console.warn('[API] 라벨 지정 실패 (무시됨):', e.message);
    }
  }

  try {
    const post = await bloggerApi.getPost({ blogId, postId: enriched.postId });
    return {
      ...enriched,
      title: post?.title || enriched.title,
      url: post?.url || enriched.url,
      status: post?.status || enriched.status,
      published: post?.published,
      updated: post?.updated,
    };
  } catch (e) {
    console.warn('[API] 포스트 정보 가져오기 실패 (무시됨):', e.message);
  }
  */

  return enriched;
}

async function runBloggerEditorWorker({
  blogId,
  title,
  htmlContent,
  imagePath,
  labels,
  customMetaData,
  postId,
  publish = true
}) {
  if (!blogId || !title || !htmlContent) {
    throw new Error("Blogger 에디터 워커 실행에 필요한 blogId/title/htmlContent가 누락되었습니다.");
  }

  const { email, password } = getGoogleCredentials();
  const tmpDir = path.join(process.cwd(), "tmp");
  fs.mkdirSync(tmpDir, { recursive: true });

  const dataPath = path.join(
    tmpDir,
    `blogger-worker-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`
  );

  fs.writeFileSync(
    dataPath,
    JSON.stringify({
      email,
      password,
      blogId,
      title,
      htmlContent,
      imagePath,
      labels,
      postId,
      publish
    }),
    "utf-8"
  );

  let stdout = "";

  try {
    stdout = execFileSync("node", ["src/scripts/blogger-worker-vibe.js", dataPath], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (error) {
    const stdoutText = String(error.stdout || "");
    const stderrText = String(error.stderr || "");
    const detail = [stdoutText, stderrText].filter(Boolean).join("\n").trim();
    throw new Error(`Blogger 에디터 워커 실행 실패${detail ? `: ${detail}` : ""}`);
  } finally {
    fs.unlink(dataPath, () => {});
  }

  const parsed = parseWorkerResult(stdout) || {};
  const result = await enrichWithApiData(
    {
      mode: postId ? "update" : "create",
      blogId: String(blogId),
      title,
      ...parsed
    },
    { blogId, labels, customMetaData, publish }
  );

  console.log(`[PublishResult] ${JSON.stringify(result)}`);
  return result;
}

module.exports = {
  runBloggerEditorWorker,
};
