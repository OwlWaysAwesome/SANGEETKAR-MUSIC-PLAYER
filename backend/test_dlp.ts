/// <reference types="node" />
import { execSync } from 'child_process';

const videoId = 'EeUnBsm1Cew';
const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;
console.log('Fetching...');
const result = execSync(
  `yt-dlp -f bestaudio -j --no-warnings "${ytUrl}"`,
  { encoding: 'utf-8', timeout: 30000, maxBuffer: 10 * 1024 * 1024 }
).trim();

try {
  const data = JSON.parse(result);
  console.log('URL exists:', !!data.url);
  console.log('Headers:', data.http_headers);
} catch (e: any) {
  console.error('Failed to parse:', e.message);
}
