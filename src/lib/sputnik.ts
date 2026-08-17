// Raw Sputnikmusic client: fetch + hand-written HTML extraction (no HTML
// parser dependency — regex/string poiminta against the site's actual markup,
// pinned down by inspecting a live fetch of bestnewmusic on 2026-08-17). No
// tool/business logic here — that belongs in src/tools/sputnik.ts.

const BASE_URL = 'https://www.sputnikmusic.com';
const USER_AGENT = 'Mozilla/5.0 (compatible; pfp-bot/0.1; +https://github.com/)';

// Set PFP_DEBUG=1 to see every request/response on stderr.
function debugLog(...args: unknown[]): void {
	if (process.env.PFP_DEBUG) console.error('[sputnik]', ...args);
}

export class SputnikError extends Error {
	constructor(public status: number, message: string) {
		super(message);
		this.name = 'SputnikError';
	}
}

async function fetchHtml(path: string, _retried = false): Promise<string> {
	const url = path.startsWith('http') ? path : `${BASE_URL}${path}`;
	debugLog('GET', url);
	let res: Response;
	try {
		res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
	} catch (err) {
		debugLog('NETWORK ERROR', (err as Error).message);
		// Transient network error (DNS blip, reset, timeout) — one retry before giving up.
		if (!_retried) {
			await new Promise((r) => setTimeout(r, 500));
			return fetchHtml(path, true);
		}
		throw new SputnikError(0, `Sputnikmusic: verkkovirhe haettaessa ${url}: ${(err as Error).message}`);
	}
	debugLog('->', res.status, url);
	if (res.status === 429 && !_retried) {
		const retryAfterMs = Number(res.headers.get('Retry-After') ?? '3') * 1000;
		debugLog('429, retrying after', retryAfterMs, 'ms');
		await new Promise((r) => setTimeout(r, retryAfterMs));
		return fetchHtml(path, true);
	}
	if (res.status >= 500 && !_retried) {
		debugLog(res.status, 'retrying once');
		await new Promise((r) => setTimeout(r, 500));
		return fetchHtml(path, true);
	}
	if (!res.ok) {
		debugLog('FAILED', res.status);
		throw new SputnikError(res.status, `Sputnikmusic ${res.status} haettaessa ${url}`);
	}
	return res.text();
}

function decodeEntities(text: string): string {
	return text
		.replace(/&amp;/g, '&')
		.replace(/&#39;/g, "'")
		.replace(/&quot;/g, '"')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.trim();
}

function stripTags(html: string): string {
	return decodeEntities(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
}

export interface BestNewMusicEntry {
	artist: string;
	album: string;
	url: string;
}

// Each entry on /bestnewmusic is two <a href=/album/ID/Slug/> anchors back to
// back — the first wraps the cover <img>, the second wraps the artist/album
// text in <strong>Artist</strong><font size=2><br>Album</a>. Match the second
// shape directly; it carries both the link and the clean text.
const ENTRY_RE =
	/<a href=(\/album\/\d+\/[^>]+)><font style="font-size:16px;"><strong>([^<]+)<\/strong><font size=2><br>([^<]+)<\/a>/g;

/** Parses the bestnewmusic listing HTML into artist/album/url entries. */
export function parseBestNewMusic(html: string): BestNewMusicEntry[] {
	const entries: BestNewMusicEntry[] = [];
	for (const match of html.matchAll(ENTRY_RE)) {
		const [, href, artist, album] = match;
		entries.push({
			artist: decodeEntities(artist),
			album: decodeEntities(album),
			url: `${BASE_URL}${href}`,
		});
	}
	return entries;
}

/** Fetches and parses the current Sputnikmusic best-new-music listing. */
export async function fetchBestNewMusic(): Promise<BestNewMusicEntry[]> {
	const html = await fetchHtml('/bestnewmusic');
	return parseBestNewMusic(html);
}

// ─── Album review page ──────────────────────────────────────────────────────

export interface MentionedTrack {
	artist: string;
	track: string;
}

export interface AlbumReview {
	artist: string;
	album: string;
	rating: number; // 0-100, normalized from Sputnik's own 0-5 scale
	reviewText: string;
	mentionedTracks: MentionedTrack[];
	listenerNotes: string[];
}

const TITLE_RE =
	/<h1[^>]*><a href="\/bands\/[^"]+\/\d+\/">([^<]+)<img[^>]*><\/a><br> <span style="font-size:20px;">([^<]+)<\/span><\/h1>/;

const RATING_RE = /color:#ff0000;">([\d.]+)<\/span><br><span style="font-size:10px;">([^<]+)<\/span>/;

// Review body sits between id="leftColumn" and the Facebook widget div that
// follows it — everything in between is the "Review Summary:" blurb + the
// full review paragraphs, as markup (<i>, <br />, entities and all).
const REVIEW_BLOCK_RE = /id="leftColumn">([\s\S]*?)<div id="fb-root">/;

// Track titles appear as curly-double-quoted text NOT wrapped in <i></i>
// (lyric quotations and other album titles use <i> — either italicized
// outright, or italicized AND curly-quoted for a sung lyric line). Stripping
// <i>...</i> spans first before hunting for curly quotes isolates real track
// mentions cleanly.
const TRACK_QUOTE_RE = /“([^”]{1,60})”/g;

const COMMENT_RE = /<td class=default valign=top><p class=pad[^>]*>([\s\S]*?)<\/p>/g;

/** Parses a Sputnikmusic album/review page into structured data. */
export function parseAlbumReview(html: string): AlbumReview {
	const titleMatch = TITLE_RE.exec(html);
	if (!titleMatch) {
		throw new SputnikError(0, 'Sputnikmusic: albumin nimeä/artistia ei löytynyt sivulta.');
	}
	const artist = decodeEntities(titleMatch[1]);
	const album = decodeEntities(titleMatch[2]);

	const ratingMatch = RATING_RE.exec(html);
	const rating = ratingMatch ? Math.round((Number.parseFloat(ratingMatch[1]) / 5) * 100) : 0;

	const reviewBlockMatch = REVIEW_BLOCK_RE.exec(html);
	const reviewBlockHtml = reviewBlockMatch ? reviewBlockMatch[1] : '';
	const reviewText = stripTags(reviewBlockHtml);

	const trackSourceHtml = reviewBlockHtml.replace(/<i>[\s\S]*?<\/i>/g, ' ');
	const seenTracks = new Set<string>();
	const mentionedTracks: MentionedTrack[] = [];
	for (const match of trackSourceHtml.matchAll(TRACK_QUOTE_RE)) {
		const track = decodeEntities(match[1]);
		const key = track.toLowerCase();
		if (seenTracks.has(key)) continue;
		seenTracks.add(key);
		mentionedTracks.push({ artist, track });
	}

	const listenerNotes: string[] = [];
	for (const match of html.matchAll(COMMENT_RE)) {
		const note = stripTags(match[1]);
		if (note) listenerNotes.push(note);
	}

	return { artist, album, rating, reviewText, mentionedTracks, listenerNotes };
}

/** Fetches and parses a Sputnikmusic album review page (follows the /album/ → /review/ redirect). */
export async function fetchAlbumReview(url: string): Promise<AlbumReview> {
	if (!url.startsWith(BASE_URL)) {
		throw new SputnikError(0, `Sputnikmusic: odottamaton URL (${url}) — pitää olla ${BASE_URL}/...`);
	}
	const html = await fetchHtml(url);
	return parseAlbumReview(html);
}
