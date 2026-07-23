import axios from 'axios';
import * as cheerio from 'cheerio';
import ytSearch from 'yt-search';
import { Innertube } from 'youtubei.js';

const fetch = require('isomorphic-unfetch');
const { getTracks, getPreview } = require('spotify-url-info')(fetch);

export interface TrackMetadata {
    title: string;
    artist: string;
}

export interface ResolvedTrack {
    videoId: string;
    title: string;
    author: string;
    thumbnail: string;
}

export interface ParsedPlaylist {
    title: string;
    tracks: ResolvedTrack[];
}

const MAX_TRACKS = 100;

/**
 * Helper to resolve text queries to YouTube videos.
 */
async function resolveTracksToYouTube(queries: TrackMetadata[]): Promise<ResolvedTrack[]> {
    const limit = Math.min(queries.length, MAX_TRACKS);
    const resolved: ResolvedTrack[] = [];
    
    const CHUNK_SIZE = 5;
    for (let i = 0; i < limit; i += CHUNK_SIZE) {
        const chunk = queries.slice(i, i + CHUNK_SIZE);
        const promises = chunk.map(async (q) => {
            const query = `${q.title} ${q.artist} audio`;
            try {
                const r = await ytSearch(query);
                if (r.videos && r.videos.length > 0) {
                    const v = r.videos[0];
                    return {
                        videoId: v.videoId,
                        title: v.title,
                        author: v.author.name,
                        thumbnail: v.thumbnail || ''
                    };
                }
            } catch (e) {
                console.error('Failed to resolve track:', query, e);
            }
            return null;
        });

        const results = await Promise.all(promises);
        for (const res of results) {
            if (res) resolved.push(res);
        }
    }
    
    return resolved;
}

export async function resolveTrackJIT(query: string, trackObj: any): Promise<any> {
    try {
        const r = await ytSearch(query);
        if (r.videos && r.videos.length > 0) {
            const v = r.videos[0];
            trackObj.videoId = v.videoId;
            trackObj.thumbnail = v.thumbnail || trackObj.thumbnail || '';
        }
    } catch (e) {
        console.error('Failed JIT resolve:', query, e);
    }
    return trackObj;
}

export async function parseSpotify(url: string): Promise<ParsedPlaylist> {
    const preview = await getPreview(url);
    const playlistTitle = preview.title || 'Spotify Playlist';
    const playlistImage = preview.image || '';
    
    const tracksInfo = await getTracks(url);
    const limit = Math.min(tracksInfo.length, MAX_TRACKS);
    
    const resolved: ResolvedTrack[] = [];
    for (let i = 0; i < limit; i++) {
        const t = tracksInfo[i];
        resolved.push({
            videoId: '',
            title: t.name,
            author: t.artists ? t.artists.map((a: any) => a.name).join(', ') : (t.artist || ''),
            thumbnail: t.album?.images?.[0]?.url || t.coverArt?.sources?.[0]?.url || playlistImage || `https://ui-avatars.com/api/?name=${encodeURIComponent(t.name)}&background=1f1f1f&color=fff`
        });
    }

    return {
        title: playlistTitle,
        tracks: resolved
    };
}

export async function parseAppleMusic(url: string): Promise<ParsedPlaylist> {
    const res = await axios.get(url);
    const $ = cheerio.load(res.data);
    let playlistTitle = $('title').text() || 'Apple Music Playlist';
    
    // clean up title
    playlistTitle = playlistTitle.replace('- Apple Music', '').trim();

    let tracks: TrackMetadata[] = [];
    $('script[type="application/ld+json"]').each((i, el) => {
        try {
            const json = JSON.parse($(el).html() || '{}');
            if (json.track && Array.isArray(json.track)) {
                tracks = json.track.map((t: any) => ({
                    title: t.name,
                    artist: t.byArtist ? t.byArtist.map((a: any) => a.name).join(', ') : ''
                }));
            }
        } catch (e) {}
    });

    // fallback if JSON-LD fails
    if (tracks.length === 0) {
        $('.songs-list-row').each((i, el) => {
            const name = $(el).find('.songs-list-row__song-name').text().trim();
            const artist = $(el).find('.songs-list-row__by-line').text().trim();
            if (name) tracks.push({ title: name, artist });
        });
    }

    const limit = Math.min(tracks.length, MAX_TRACKS);
    const resolved: ResolvedTrack[] = [];
    for (let i = 0; i < limit; i++) {
        resolved.push({
            videoId: '',
            title: tracks[i].title,
            author: tracks[i].artist,
            thumbnail: 'https://ui-avatars.com/api/?name=Track&background=1f1f1f&color=fff' // Apple music doesn't provide easy thumbnails via HTML meta mostly
        });
    }

    return {
        title: playlistTitle,
        tracks: resolved
    };
}

export async function parseYouTube(url: string): Promise<ParsedPlaylist> {
    if (!url.startsWith('http')) {
        url = 'https://' + url;
    }
    const urlObj = new URL(url);
    const listId = urlObj.searchParams.get('list');
    
    if (!listId) {
        throw new Error('Invalid YouTube playlist URL');
    }

    const yt = await Innertube.create();
    const isMusic = urlObj.hostname === 'music.youtube.com';
    let playlist;
    try {
        if (isMusic) {
            playlist = await yt.music.getPlaylist(listId);
        } else {
            playlist = await yt.getPlaylist(listId);
        }
    } catch (e) {
        console.warn("Falling back to standard yt.getPlaylist", e);
        playlist = await yt.getPlaylist(listId);
    }
    
    const p = playlist as any;
    const playlistTitle = p.info?.title || p.header?.title?.text || p.title || 'YouTube Playlist';
    
    const limit = Math.min(p.items?.length || 0, MAX_TRACKS);
    const resolved: ResolvedTrack[] = [];

    for (let i = 0; i < limit; i++) {
        try {
            const item = p.items[i] as any;
            if (item.id) {
                let title: any = 'Unknown Title';
                let author: any = 'Unknown Author';
                
                try {
                    title = item.title?.text || item.title || item.name || 'Unknown Title';
                } catch(e) {}
                
                try {
                    author = item.author?.name || item.author || item.authors?.[0]?.name || item.artists?.[0]?.name || item.artists || 'Unknown Author';
                } catch (e) {}

                resolved.push({
                    videoId: item.id,
                    title: typeof title === 'string' ? title : String(title),
                    author: typeof author === 'string' ? author : String(author),
                    thumbnail: item.thumbnails?.[0]?.url || `https://img.youtube.com/vi/${item.id}/hqdefault.jpg`
                });
            }
        } catch (err) {
            console.error("Skipping a track due to parser crash:", err);
        }
    }

    return {
        title: playlistTitle,
        tracks: resolved
    };
}
