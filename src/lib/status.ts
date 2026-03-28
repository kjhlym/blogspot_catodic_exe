import fs from 'fs';
import path from 'path';

const statusFilePath = path.join(process.cwd(), 'publish-status.json');
// console.log('[Status] statusFilePath:', statusFilePath);


export function getPublishStatuses(): Record<string, string> {
  try {
    if (fs.existsSync(statusFilePath)) {
      const data = fs.readFileSync(statusFilePath, 'utf-8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('Failed to read publish-status.json:', err);
  }
  return {};
}

export function setPublishStatus(link: string, status: string): void {
  try {
    const statuses = getPublishStatuses();
    statuses[link] = status;
    fs.writeFileSync(statusFilePath, JSON.stringify(statuses, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to update publish-status.json:', err);
  }
}
