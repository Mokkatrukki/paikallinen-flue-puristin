import { afterEach, describe, expect, mock, test } from 'bun:test';

const { parseBestNewMusic, fetchBestNewMusic, parseAlbumReview, fetchAlbumReview, SputnikError } = await import(
	'../src/lib/sputnik.ts'
);
const { sputnikListBestNewMusic, sputnikGetAlbumReview } = await import('../src/tools/sputnik.ts');

const ctx = { signal: new AbortController().signal, log: { info() {}, warn() {}, error() {} }, toolCallId: 't1' } as any;

const originalFetch = globalThis.fetch;

afterEach(() => {
	// @ts-expect-error test cleanup
	globalThis.fetch = originalFetch;
});

function stubFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
	// @ts-expect-error test stub
	globalThis.fetch = mock(async (input: string | URL, init: RequestInit = {}) => handler(String(input), init));
}

const SAMPLE_HTML =
	'<a href=/album/550037/Marilyn-Manson-One-Assassination-Under-God---Chapter-2/><img src=/images/albums/550037.jpg-thumbl></a>' +
	'<a href=/album/550037/Marilyn-Manson-One-Assassination-Under-God---Chapter-2/><font style="font-size:16px;">' +
	'<strong>Marilyn Manson</strong><font size=2><br>One Assassination Under God - Chapter 2</a>' +
	'<br><br><span>blurb here</span>' +
	'<a href=/album/545259/M-and-Ms-Rock-%26-Roll/><img src=/images/albums/545259.jpg-thumbl></a>' +
	'<a href=/album/545259/M-and-Ms-Rock-%26-Roll/><font style="font-size:16px;">' +
	'<strong>M &amp; Ms</strong><font size=2><br>Rock &amp; Roll</a>';

describe('parseBestNewMusic', () => {
	test('extracts artist, album, and full url from the listing markup', () => {
		const entries = parseBestNewMusic(SAMPLE_HTML);
		expect(entries).toEqual([
			{
				artist: 'Marilyn Manson',
				album: 'One Assassination Under God - Chapter 2',
				url: 'https://www.sputnikmusic.com/album/550037/Marilyn-Manson-One-Assassination-Under-God---Chapter-2/',
			},
			{
				artist: 'M & Ms',
				album: 'Rock & Roll',
				url: 'https://www.sputnikmusic.com/album/545259/M-and-Ms-Rock-%26-Roll/',
			},
		]);
	});

	test('returns an empty list when nothing matches', () => {
		expect(parseBestNewMusic('<html><body>nothing here</body></html>')).toEqual([]);
	});
});

describe('fetchBestNewMusic', () => {
	test('fetches the listing page and parses it', async () => {
		let seenUrl = '';
		stubFetch((url) => {
			seenUrl = url;
			return new Response(SAMPLE_HTML, { status: 200 });
		});
		const entries = await fetchBestNewMusic();
		expect(seenUrl).toBe('https://www.sputnikmusic.com/bestnewmusic');
		expect(entries).toHaveLength(2);
	});

	test('throws SputnikError on a non-2xx response', async () => {
		stubFetch(() => new Response('nope', { status: 503 }));
		await expect(fetchBestNewMusic()).rejects.toThrow('Sputnikmusic 503');
	});
});

const ALBUM_HTML =
	'<h1><a href="/bands/Marilyn-Manson/900/">Marilyn Manson<img src=x></a><br> <span style="font-size:20px;">One Assassination Under God - Chapter 2</span></h1>' +
	'<span style="font-size:17px;font-weight:bold;color:#ff0000;">4.3</span><br><span style="font-size:10px;">superb</span>' +
	'id="leftColumn"><div><b>Review Summary:</b> A strong comeback.</div><br>' +
	'“Exit Wound” is a highlight, and as he sings <i>“dressed in his mortuary best”</i> it hits hard. “Exit Wound” again later, dedupe check.' +
	'<div id="fb-root"></div>' +
	'<td class=default valign=top><p class=pad style="color:#444;font-size:12px;"><font size=2 class=brighttext><b>Album Rating: 4.5</font></font></b><br><br>Loved it, Exit Wound slaps.<br><br></p>';

describe('parseAlbumReview', () => {
	test('extracts title, rating, review text, deduped track mentions (skipping italicized lyrics), and listener notes', () => {
		const review = parseAlbumReview(ALBUM_HTML);
		expect(review.artist).toBe('Marilyn Manson');
		expect(review.album).toBe('One Assassination Under God - Chapter 2');
		expect(review.rating).toBe(86); // 4.3 / 5 * 100, rounded
		expect(review.reviewText).toContain('Review Summary: A strong comeback.');
		expect(review.reviewText).toContain('dressed in his mortuary best');
		expect(review.mentionedTracks).toEqual([{ artist: 'Marilyn Manson', track: 'Exit Wound' }]);
		expect(review.listenerNotes).toEqual(['Album Rating: 4.5 Loved it, Exit Wound slaps.']);
	});

	test('throws when the title markup is missing', () => {
		expect(() => parseAlbumReview('<html>nope</html>')).toThrow('nimeä');
	});
});

describe('fetchAlbumReview', () => {
	test('rejects urls outside sputnikmusic.com', async () => {
		await expect(fetchAlbumReview('https://evil.example/x')).rejects.toThrow('odottamaton URL');
	});

	test('fetches and parses a review page', async () => {
		stubFetch(() => new Response(ALBUM_HTML, { status: 200 }));
		const review = await fetchAlbumReview('https://www.sputnikmusic.com/review/91107/x/');
		expect(review.artist).toBe('Marilyn Manson');
	});
});

describe('sputnik_get_album_review tool', () => {
	test('returns the parsed review for the given url', async () => {
		stubFetch(() => new Response(ALBUM_HTML, { status: 200 }));
		const result = await sputnikGetAlbumReview.run({
			data: { url: 'https://www.sputnikmusic.com/review/91107/x/' },
			...ctx,
		});
		expect(result.output.rating).toBe(86);
		expect(result.output.mentionedTracks).toEqual([{ artist: 'Marilyn Manson', track: 'Exit Wound' }]);
	});
});

describe('sputnik_list_best_new_music tool', () => {
	test('returns albums parsed from the live listing', async () => {
		stubFetch(() => new Response(SAMPLE_HTML, { status: 200 }));
		const result = await sputnikListBestNewMusic.run({ data: {}, ...ctx });
		expect(result.output.albums).toHaveLength(2);
		expect(result.output.albums[0]).toEqual({
			artist: 'Marilyn Manson',
			album: 'One Assassination Under God - Chapter 2',
			url: 'https://www.sputnikmusic.com/album/550037/Marilyn-Manson-One-Assassination-Under-God---Chapter-2/',
		});
	});
});
