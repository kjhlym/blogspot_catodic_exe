const DEFAULT_BLOG_KEY = 'cathodicProtection';

const BLOG_ID_MAP = {
  sidejob: '2901491127168098993',
  news: '1594942893618134523',
  trend: '5494811512658329683',
  shopping: '2774347826915898293',
  economy: '7800743330422240838',
  it: '1049165083657379021',
  tennis: '2887648950361340299',
  health: '7633785215045108977',
  education: '8195656863384479720',
  cathodicProtection: '8175487819803632040',
};

const BLOG_ENV_MAP = {
  sidejob: 'BLOGGER_BLOG_ID_SIDEJOB',
  news: 'BLOGGER_BLOG_ID_NEWS',
  trend: 'BLOGGER_BLOG_ID_TREND',
  shopping: 'BLOGGER_BLOG_ID_SHOPPING',
  economy: 'BLOGGER_BLOG_ID_ECONOMY',
  it: 'BLOGGER_BLOG_ID_IT',
  tennis: 'BLOGGER_BLOG_ID_TENNIS',
  health: 'BLOGGER_BLOG_ID_HEALTH',
  education: 'BLOGGER_BLOG_ID_EDUCATION',
  cathodicProtection: 'BLOGGER_BLOG_ID_CATHODIC_PROTECTION',
};

const CATEGORY_RULES = [
  {
    blogKey: 'it',
    exactAliases: ['AI/IT', 'IT'],
    includesKeywords: [],
  },
  {
    blogKey: 'tennis',
    exactAliases: ['테니스'],
    includesKeywords: ['테니스'],
  },
  {
    blogKey: 'economy',
    exactAliases: ['경제', '40대 재테크', '60대 은퇴/경제'],
    includesKeywords: ['재테크'],
  },
  {
    blogKey: 'health',
    exactAliases: ['40대 건강/라이프', '40대 건강건강/라이프', '60대 건강관리', '건강관리'],
    includesKeywords: ['건강/라이프', '건강관리'],
  },
  {
    blogKey: 'education',
    exactAliases: ['40대 자녀교육', '40대 자기계발', '교육', '자기계발'],
    includesKeywords: ['자녀교육', '자기계발'],
  },
  {
    blogKey: 'cathodicProtection',
    exactAliases: ['cathodicProtection', '전기방식', '국제 기술 표준 분석', '학술 정보 및 최신 연구', '글로벌 기업 기술 블로그', 'AI 및 실무 실전 가이드'],
    includesKeywords: ['전기방식', 'cp', '부식', 'cathodic'],
  },
  {
    blogKey: 'sidejob',
    exactAliases: ['부업'],
    includesKeywords: ['부업'],
  },
  {
    blogKey: 'news',
    exactAliases: ['뉴스'],
    includesKeywords: [],
  },
  {
    blogKey: 'trend',
    exactAliases: ['트렌드', '트랜드'],
    includesKeywords: [],
  },
  {
    blogKey: 'shopping',
    exactAliases: ['상품'],
    includesKeywords: [],
  },
];

function normalizeCategory(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[()]/g, '');
}

function isExactMatch(rule, normalizedCategory) {
  return rule.exactAliases.some((alias) => normalizeCategory(alias) === normalizedCategory);
}

function isIncludesMatch(rule, normalizedCategory) {
  return rule.includesKeywords.some((keyword) => normalizedCategory.includes(normalizeCategory(keyword)));
}

function inferBlogKey(category) {
  const normalizedCategory = normalizeCategory(category);
  if (!normalizedCategory) {
    return DEFAULT_BLOG_KEY;
  }

  for (const rule of CATEGORY_RULES) {
    if (isExactMatch(rule, normalizedCategory)) {
      return rule.blogKey;
    }
  }

  for (const rule of CATEGORY_RULES) {
    if (isIncludesMatch(rule, normalizedCategory)) {
      return rule.blogKey;
    }
  }

  return DEFAULT_BLOG_KEY;
}

function getBlogIdForKey(blogKey) {
  const envKey = BLOG_ENV_MAP[blogKey];
  return (
    (envKey ? process.env[envKey] : undefined) ||
    BLOG_ID_MAP[blogKey] ||
    process.env.BLOGGER_DEFAULT_BLOG_ID ||
    BLOG_ID_MAP[DEFAULT_BLOG_KEY]
  );
}

function resolveBloggerTarget(category, blogId, blogUrl) {
  const normalizedCategory = String(category || '전기방식').trim() || '전기방식';
  const blogKey = inferBlogKey(normalizedCategory);

  return {
    category: normalizedCategory,
    blogKey,
    blogId: blogId || getBlogIdForKey(blogKey),
    blogUrl: blogUrl || process.env.BLOGGER_BLOG_URL || undefined,
  };
}

module.exports = {
  BLOG_ENV_MAP,
  BLOG_ID_MAP,
  CATEGORY_RULES,
  DEFAULT_BLOG_KEY,
  getBlogIdForKey,
  inferBlogKey,
  normalizeCategory,
  resolveBloggerTarget,
};
