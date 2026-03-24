import { NextResponse } from 'next/server';
import { bloggerQueue } from '@/lib/queue';

export async function POST(req: Request) {
  try {
    const data = await req.json();
    
    // 필수 필드 검증
    if (!data.blogId || !data.title || !data.htmlContent) {
      return NextResponse.json({ error: '필수 데이터가 누락되었습니다.' }, { status: 400 });
    }

    // 큐에 작업 추가
    const job = await bloggerQueue.add('blogger-post', data, {
      removeOnComplete: true,
      removeOnFail: false,
    });

    return NextResponse.json({ success: true, jobId: job.id });
  } catch (error: any) {
    console.error('API Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function GET() {
  try {
    const jobs = await bloggerQueue.getJobs(['waiting', 'active', 'completed', 'failed']);
    return NextResponse.json({ 
      count: jobs.length,
      jobs: jobs.map(j => ({
        id: j.id,
        name: j.name,
        data: { title: j.data.title, blogId: j.data.blogId },
        status: j.getState(),
        progress: j.progress,
        failedReason: j.failedReason,
      }))
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
