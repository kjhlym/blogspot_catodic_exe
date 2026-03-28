import { runCurationCrawler } from '../lib/curation-crawler';

async function main() {
  const args = process.argv.slice(2);
  const groupArgIndex = args.indexOf('--group');
  let groupFilter: string | undefined = groupArgIndex !== -1 ? args[groupArgIndex + 1] : args[0];
  
  // 만약 첫 번째 인자가 --로 시작한다면 필터가 아니라고 판단
  if (groupFilter && groupFilter.startsWith('--')) {
    groupFilter = undefined;
  }

  console.log(`[CLI] Curation Crawler 시작 (필터: ${groupFilter || '전체'})`);
  
  // Note: runCurationCrawler now accepts a filter.
  await runCurationCrawler(groupFilter || undefined);
}

main().catch(err => {
  console.error('[CLI] Curation Crawler 실패:', err);
  process.exit(1);
});
