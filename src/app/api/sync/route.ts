import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { bloggerQueue } from '@/lib/queue';

export async function POST() {
  try {
    const dbPath = path.join(process.cwd(), 'data', 'curation-db.json');
    
    if (!fs.existsSync(dbPath)) {
      return NextResponse.json({ error: 'Curation DB not found' }, { status: 404 });
    }

    const dbContent = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
    let addedCount = 0;

    // Iterate through all groups and items
    for (const groupKey in dbContent) {
      const group = dbContent[groupKey];
      if (group.items && Array.isArray(group.items)) {
        for (const item of group.items) {
          // Add to queue
          await bloggerQueue.add('rpa-post-job', {
            blogId: item.blogId || '8613426021178496417', // Default blog ID
            title: item.title,
            htmlContent: item.description || 'No description provided.',
            tags: [item.category || 'General', 'RPA'],
            isTest: !!group.group?.isTest
          });
          addedCount++;
        }
      }
    }

    return NextResponse.json({ 
      success: true, 
      message: `${addedCount} jobs imported from curation-db.json` 
    });
  } catch (error) {
    console.error('Sync Error:', error);
    return NextResponse.json({ error: 'Failed to sync database' }, { status: 500 });
  }
}
