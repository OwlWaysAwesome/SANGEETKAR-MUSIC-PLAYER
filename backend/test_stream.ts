/// <reference types="node" />
import { Innertube } from 'youtubei.js';

async function test() {
  const yt = await Innertube.create();
  const info = await yt.getInfo('dQw4w9WgXcQ');
  
  const sd = info.streaming_data;
  console.log('HLS manifest:', sd?.hls_manifest_url?.substring(0, 200));
  console.log('DASH manifest:', sd?.dash_manifest_url?.substring(0, 200));
  console.log('Server ABR:', (sd as any)?.server_abr_streaming_url?.substring(0, 200));
  
  // Try fetching HLS manifest to get actual stream URLs
  if (sd?.hls_manifest_url) {
    const axios = require('axios');
    const resp = await axios.get(sd.hls_manifest_url);
    const lines = resp.data.split('\n').filter((l: string) => l.includes('http') || l.includes('#EXT-X-STREAM-INF'));
    console.log('\nHLS streams (first 10 lines):');
    lines.slice(0, 10).forEach((l: string) => console.log(' ', l.substring(0, 200)));
  }
}

test().catch(console.error);
