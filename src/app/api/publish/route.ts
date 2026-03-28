import { NextRequest, NextResponse } from 'next/server';
import { logManager } from '@/lib/log-manager';
import { bloggerQueue } from '@/lib/queue';

interface PublishItem {
  id: string;
  keyword: string;
  title: string;
  topic: string;
  summary: string;
  link: string;
  category?: string;
  domain?: string;
}

export async function POST(req: NextRequest) {
  try {
    const { items, headless } = await req.json(); // frontend sends headless here

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'No items provided' }, { status: 400 });
    }

    // items가 큐에 추가될 때 headless 옵션도 같이 전달되도록 처리
    await startPublishingJobsInQueue(items, { headless });

    return NextResponse.json({ 
      success: true, 
      message: `${items.length}개 아티클 발행 작업이 큐에 추가되었습니다.` 
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

async function startPublishingJobsInQueue(items: PublishItem[], options: { headless?: boolean }) {
  logManager.setAborted(false);
  logManager.broadcast('status', 'running', { message: '발행 작업 큐 등록 중' });
  
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    
    // 도메인 또는 카테고리에 따른 블로그 ID 배정 로직
    let blogId = process.env.BLOGGER_DEFAULT_BLOG_ID || process.env.BLOGGER_BLOG_ID || "";
    
    // 생활문화 전용 블로그 ID (8772286578401026851) 매핑 강화
    // 1. 도메인이 'lifeculture'인 경우
    // 2. 카테고리에 '생활문화'가 포함된 경우
    // 3. 토픽에 '생활'이나 '문화'가 포함된 경우
    const isLifeCulture = 
      item.domain === 'lifeculture' || 
      item.category?.includes('생활문화') || 
      /생활|문화|life|culture/i.test(item.topic || "") ||
      /생활|문화/i.test(item.category || "");

    if (isLifeCulture) {
      blogId = process.env.BLOGGER_LIFECULTURE_BLOG_ID || "8772286578401026851";
    }

    logManager.broadcast('log', `[${i + 1}/${items.length}] 큐 등록: ${item.keyword} (Domain: ${item.domain}, Blog: ${blogId === process.env.BLOGGER_LIFECULTURE_BLOG_ID ? 'Life' : 'Default'})`);
    
    await bloggerQueue.add('publish-job', {
      email: process.env.GOOGLE_GEMINI_ID,
      password: process.env.GOOGLE_GEMINI_PW,
      blogId: blogId,
      topic: item.topic,
      keyword: item.keyword,
      summary: item.summary,
      link: item.link,
      category: item.category,
      headless: options.headless !== undefined ? options.headless : false, // 기본값 false (Headed)
      publish: true,
    }, {
      jobId: `publish-${Date.now()}-${i}`,
      removeOnComplete: true,
      removeOnFail: false
    });
  }

  logManager.broadcast('done', '작업 등록 완료', {
    success: items.length,
    failed: 0,
    total: items.length
  });
  logManager.broadcast('status', 'idle');
}
