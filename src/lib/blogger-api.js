const BLOGGER_API_BASE = "https://www.googleapis.com/blogger/v3";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

let cachedToken = null;
let cachedTokenExpiresAt = 0;

function hasRefreshTokenConfig() {
  return Boolean(
    process.env.BLOGGER_REFRESH_TOKEN &&
      process.env.GOOGLE_OAUTH_CLIENT_ID &&
      process.env.GOOGLE_OAUTH_CLIENT_SECRET
  );
}

function parseBooleanEnv(name, defaultValue) {
  const raw = process.env[name];
  if (raw == null || raw === "") return defaultValue;
  return /^(1|true|yes|on)$/i.test(raw);
}

function isBloggerApiConfigured() {
  return Boolean(process.env.BLOGGER_ACCESS_TOKEN) || hasRefreshTokenConfig();
}

async function requestNewAccessToken() {
  if (!hasRefreshTokenConfig()) {
    throw new Error(
      "Blogger API refresh token 설정이 없습니다. BLOGGER_REFRESH_TOKEN, GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET를 확인하세요."
    );
  }

  const payload = new URLSearchParams({
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID,
    client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    refresh_token: process.env.BLOGGER_REFRESH_TOKEN,
    grant_type: "refresh_token"
  });

  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: payload.toString()
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google OAuth 토큰 갱신 실패 (${response.status}): ${text}`);
  }

  const data = await response.json();
  const expiresIn = Number(data.expires_in || 3600);

  cachedToken = data.access_token;
  cachedTokenExpiresAt = Date.now() + Math.max(expiresIn - 60, 60) * 1000;

  return cachedToken;
}

async function getAccessToken(forceRefresh = false) {
  if (!forceRefresh) {
    if (cachedToken && Date.now() < cachedTokenExpiresAt) {
      return cachedToken;
    }

    if (!hasRefreshTokenConfig() && process.env.BLOGGER_ACCESS_TOKEN) {
      return process.env.BLOGGER_ACCESS_TOKEN;
    }
  }

  if (hasRefreshTokenConfig()) {
    return requestNewAccessToken();
  }

  if (process.env.BLOGGER_ACCESS_TOKEN) {
    return process.env.BLOGGER_ACCESS_TOKEN;
  }

  throw new Error(
    "Blogger API 인증 정보가 없습니다. BLOGGER_ACCESS_TOKEN 또는 refresh token 설정이 필요합니다."
  );
}

async function bloggerRequest(endpoint, options = {}) {
  const {
    method = "GET",
    query = {},
    body,
    retryOnAuthError = true
  } = options;

  const url = new URL(`${BLOGGER_API_BASE}${endpoint}`);
  for (const [key, value] of Object.entries(query)) {
    if (value == null || value === "") continue;
    url.searchParams.set(key, String(value));
  }

  const token = await getAccessToken(false);
  
  let response;
  let lastError;
  for (let i = 0; i < 3; i++) {
    try {
      response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: body == null ? undefined : JSON.stringify(body)
      });
      break;
    } catch (err) {
      lastError = err;
      console.warn(`[API] Fetch 시도 ${i+1} 실패, 재시도 중... (${err.message})`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  if (!response) {
    throw new Error(`Blogger API 네트워크 연결 실패 (3회 시도): ${lastError.message}`);
  }

  if (response.status === 401 && retryOnAuthError && hasRefreshTokenConfig()) {
    const refreshedToken = await getAccessToken(true);
    response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${refreshedToken}`,
        "Content-Type": "application/json"
      },
      body: body == null ? undefined : JSON.stringify(body)
    });
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Blogger API 요청 실패 (${method} ${url.pathname}): ${response.status} ${text}`);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

function stripMidImageMarkers(htmlContent) {
  return String(htmlContent || "").replace(/\[MID_IMAGE\]|\[MIDDLE_IMAGE\]/gi, "");
}

function stripInlineDataImages(htmlContent) {
  return String(htmlContent || "")
    .replace(/<div[^>]*>\s*<img[^>]+src=["']data:image[^"']+["'][^>]*>\s*<\/div>/gi, "")
    .replace(/<img[^>]+src=["']data:image[^"']+["'][^>]*>/gi, "");
}

function buildContentWithMidImage(htmlContent) {
  return stripInlineDataImages(stripMidImageMarkers(htmlContent));
}

async function resolveBlogId({ blogId, blogUrl }) {
  if (blogId) return String(blogId);
  if (!blogUrl) {
    throw new Error("blogId 또는 blogUrl 중 하나는 필요합니다.");
  }

  const data = await bloggerRequest("/blogs/byurl", {
    query: {
      url: blogUrl,
      view: "ADMIN"
    }
  });

  if (!data?.id) {
    throw new Error(`blogUrl로 블로그 ID를 찾지 못했습니다: ${blogUrl}`);
  }

  return String(data.id);
}

async function getBlog({ blogId, blogUrl, view = "ADMIN" }) {
  const resolvedBlogId = await resolveBlogId({ blogId, blogUrl });
  return bloggerRequest(`/blogs/${resolvedBlogId}`, {
    query: { view }
  });
}

async function getPost({ blogId, blogUrl, postId, view = "ADMIN" }) {
  const resolvedBlogId = await resolveBlogId({ blogId, blogUrl });
  return bloggerRequest(`/blogs/${resolvedBlogId}/posts/${postId}`, {
    query: { view }
  });
}

async function getPosts({ blogId, blogUrl, maxResults = 50, fetchBodies = false, view = "ADMIN" }) {
  const resolvedBlogId = await resolveBlogId({ blogId, blogUrl });
  return bloggerRequest(`/blogs/${resolvedBlogId}/posts`, {
    query: { 
      maxResults, 
      fetchBodies,
      view
    }
  });
}

async function insertPost({
  blogId,
  blogUrl,
  title,
  content,
  labels,
  customMetaData,
  fetchImages,
  isDraft,
  status
}) {
  const resolvedBlogId = await resolveBlogId({ blogId, blogUrl });

  return bloggerRequest(`/blogs/${resolvedBlogId}/posts`, {
    method: "POST",
    query: {
      fetchImages: fetchImages ?? parseBooleanEnv("BLOGGER_FETCH_IMAGES", false),
      isDraft: isDraft ?? true
    },
    body: {
      kind: "blogger#post",
      title,
      content,
      labels: Array.isArray(labels) && labels.length > 0 ? labels : undefined,
      customMetaData,
      status
    }
  });
}

async function publishPost({ blogId, blogUrl, postId, publishDate }) {
  const resolvedBlogId = await resolveBlogId({ blogId, blogUrl });
  return bloggerRequest(`/blogs/${resolvedBlogId}/posts/${postId}/publish`, {
    method: "POST",
    query: {
      publishDate
    }
  });
}

async function patchPost({
  blogId,
  blogUrl,
  postId,
  patch,
  fetchImages,
  publish
}) {
  const resolvedBlogId = await resolveBlogId({ blogId, blogUrl });
  return bloggerRequest(`/blogs/${resolvedBlogId}/posts/${postId}`, {
    method: "PATCH",
    query: {
      fetchImages: fetchImages ?? parseBooleanEnv("BLOGGER_FETCH_IMAGES", false),
      publish
    },
    body: patch
  });
}

async function updatePost({
  blogId,
  blogUrl,
  postId,
  post,
  fetchImages,
  publish,
  revert
}) {
  const resolvedBlogId = await resolveBlogId({ blogId, blogUrl });
  return bloggerRequest(`/blogs/${resolvedBlogId}/posts/${postId}`, {
    method: "PUT",
    query: {
      fetchImages: fetchImages ?? parseBooleanEnv("BLOGGER_FETCH_IMAGES", false),
      publish,
      revert
    },
    body: post
  });
}

async function createAndPublishPost({
  blogId,
  blogUrl,
  title,
  htmlContent,
  imagePath,
  labels,
  customMetaData,
  publish = true,
  publishDate,
  fetchImages
}) {
  const resolvedBlogId = await resolveBlogId({ blogId, blogUrl });
  const content = buildContentWithMidImage(htmlContent, imagePath);

  const inserted = await insertPost({
    blogId: resolvedBlogId,
    title,
    content,
    labels,
    customMetaData,
    fetchImages,
    isDraft: true
  });

  if (!publish) {
    return inserted;
  }

  return publishPost({
    blogId: resolvedBlogId,
    postId: inserted.id,
    publishDate
  });
}

module.exports = {
  buildContentWithMidImage,
  createAndPublishPost,
  getBlog,
  getPost,
  getPosts,
  insertPost,
  isBloggerApiConfigured,
  patchPost,
  publishPost,
  resolveBlogId,
  updatePost
};
