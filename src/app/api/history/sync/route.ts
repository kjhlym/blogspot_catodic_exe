import { NextResponse } from 'next/server';
import { getPosts } from '@/lib/blogger-api';
import { BLOG_ID_MAP } from '@/lib/blogger-targets';
import { addHistoryEntries, HistoryItem } from '@/lib/history';

export async function POST() {
  try {
    const allEntries: HistoryItem[] = [];
    const blogIds = Object.values(BLOG_ID_MAP);

    console.log(`[Sync] Starting sync for ${blogIds.length} blogs...`);

    // 모든 블로그 순회하며 최근 포스트 가져오기
    for (const blogId of blogIds) {
      try {
        const data = await getPosts({ blogId, blogUrl: undefined, maxResults: 10 });
        if (data && data.items) {
          const entries: HistoryItem[] = data.items.map((post: any) => ({
            link: post.url,
            title: post.title,
            time: post.published
          }));
          allEntries.push(...entries);
          console.log(`[Sync] Found ${entries.length} posts from blog ${blogId}`);
        }
      } catch (err: any) {
        console.warn(`[Sync] Failed to fetch posts for blog ${blogId}:`, err.message);
        // 특정 블로그 실패 시에도 계속 진행
      }
    }

    if (allEntries.length > 0) {
      addHistoryEntries(allEntries);
    }

    return NextResponse.json({
      success: true,
      count: allEntries.length,
      message: `${allEntries.length}개의 포스트를 확인하고 히스토리를 업데이트했습니다.`
    });
  } catch (err: any) {
    console.error('[Sync] Error during history synchronization:', err);
    return NextResponse.json({
      success: false,
      error: err.message
    }, { status: 500 });
  }
}
