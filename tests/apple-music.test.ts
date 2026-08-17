import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';

// A syntactically valid EC P-256 private key, generated solely for signing
// test JWTs offline. Not a real credential, never used against the real API.
const TEST_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgewudT98MYf9Ruywh
GgXB/jCps/qo2UUi52SrfymLfMyhRANCAASawoYP7LPQLDK6+F/jJv+PjAU5b5kf
Z1gP8Yh8d3G5qtd77ZKR8MnzCtOily+8VahCAWTLyv/r3cRhAkOIGYg3
-----END PRIVATE KEY-----`;

const TEST_DATA_DIR = 'data/test-apple-music';
const TOKEN_FILE = `${TEST_DATA_DIR}/token.json`;

process.env.APPLE_TEAM_ID = 'TEAM123456';
process.env.APPLE_KEY_ID = 'KEY1234567';
process.env.APPLE_PRIVATE_KEY = TEST_PRIVATE_KEY;
process.env.APPLE_MUSIC_TOKEN_FILE = TOKEN_FILE;
process.env.APPLE_MUSIC_STOREFRONT = 'fi';

const { developerToken, apiRequest, storefront, authStatus, saveUserToken, loadUserToken } = await import(
	'../src/lib/apple-music.ts'
);
const {
	appleMusicSearchTracks,
	appleMusicListPlaylists,
	appleMusicGetPlaylist,
	appleMusicCreatePlaylist,
	appleMusicAddTracks,
} = await import('../src/tools/apple-music.ts');

const ctx = { signal: new AbortController().signal, log: { info() {}, warn() {}, error() {} }, toolCallId: 't1' } as any;

beforeEach(() => {
	mkdirSync(TEST_DATA_DIR, { recursive: true });
});

afterEach(() => {
	if (existsSync(TEST_DATA_DIR)) rmSync(TEST_DATA_DIR, { recursive: true, force: true });
	// @ts-expect-error test cleanup
	globalThis.fetch = originalFetch;
});

const originalFetch = globalThis.fetch;

function stubFetch(handler: (url: URL, init: RequestInit) => Response | Promise<Response>) {
	// @ts-expect-error test stub
	globalThis.fetch = mock(async (input: string | URL, init: RequestInit = {}) => {
		const url = input instanceof URL ? input : new URL(String(input));
		return handler(url, init);
	});
}

describe('developerToken', () => {
	test('signs a three-part JWT with the right header and payload', () => {
		const token = developerToken();
		const [headerB64, payloadB64, sig] = token.split('.');
		expect(sig.length).toBeGreaterThan(0);

		const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString());
		expect(header).toEqual({ alg: 'ES256', kid: 'KEY1234567' });

		const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
		expect(payload.iss).toBe('TEAM123456');
		expect(payload.exp - payload.iat).toBe(15_777_000);
	});

	test('caches the token across calls', () => {
		expect(developerToken()).toBe(developerToken());
	});
});

describe('authStatus', () => {
	test('reports developer token present, user token absent by default', () => {
		const status = authStatus();
		expect(status.hasDeveloperToken).toBe(true);
		expect(status.hasUserToken).toBe(false);
	});

	test('reports user token once one is saved', () => {
		saveUserToken({ musicUserToken: 'utok', storefront: 'fi', savedAt: Date.now() });
		expect(loadUserToken()?.musicUserToken).toBe('utok');
		expect(authStatus().hasUserToken).toBe(true);
	});
});

describe('apiRequest', () => {
	test('signs requests with the developer token and hits the real base URL', async () => {
		let seenAuth = '';
		stubFetch((url) => {
			seenAuth = 'ok';
			expect(url.toString()).toStartWith('https://api.music.apple.com/v1/catalog/fi/search');
			return new Response(JSON.stringify({ results: {} }), { status: 200 });
		});
		await apiRequest('/catalog/fi/search', { params: { term: 'x' } });
		expect(seenAuth).toBe('ok');
	});

	test('throws AppleMusicError with the status on a non-2xx response', async () => {
		stubFetch(() => new Response('nope', { status: 400 }));
		await expect(apiRequest('/whatever')).rejects.toThrow('Apple Music API 400');
	});

	test('requireUserToken throws before making a request when no user token is saved', async () => {
		let called = false;
		stubFetch(() => {
			called = true;
			return new Response('{}', { status: 200 });
		});
		await expect(apiRequest('/me/library/playlists', { requireUserToken: true })).rejects.toThrow(
			'Ei Music User Tokenia',
		);
		expect(called).toBe(false);
	});

	test('retries once on 401 then succeeds', async () => {
		let calls = 0;
		stubFetch(() => {
			calls++;
			if (calls === 1) return new Response('unauthorized', { status: 401 });
			return new Response(JSON.stringify({ ok: true }), { status: 200 });
		});
		const res = await apiRequest('/me/library/playlists');
		expect(res).toEqual({ ok: true });
		expect(calls).toBe(2);
	});
});

describe('tools', () => {
	test('apple_music_search_tracks parses catalog search results', async () => {
		stubFetch((url) => {
			expect(url.searchParams.get('term')).toBe('Glory Box');
			expect(url.searchParams.get('types')).toBe('songs');
			return new Response(
				JSON.stringify({
					results: {
						songs: {
							data: [
								{ id: '1', attributes: { name: 'Glory Box', artistName: 'Portishead', albumName: 'Dummy' } },
							],
						},
					},
				}),
				{ status: 200 },
			);
		});
		const result = await appleMusicSearchTracks.run({ data: { query: 'Glory Box', limit: 5 }, ...ctx });
		expect(result.output).toEqual({
			tracks: [{ trackId: '1', name: 'Glory Box', artistName: 'Portishead', albumName: 'Dummy' }],
		});
	});

	test('apple_music_search_tracks returns an empty list when nothing matches', async () => {
		stubFetch(() => new Response(JSON.stringify({ results: {} }), { status: 200 }));
		const result = await appleMusicSearchTracks.run({ data: { query: 'asdfasdfasdf' }, ...ctx });
		expect(result.output).toEqual({ tracks: [] });
	});

	test('apple_music_list_playlists requires a user token', async () => {
		await expect(appleMusicListPlaylists.run({ data: {}, ...ctx })).rejects.toThrow('Ei Music User Tokenia');
	});

	test('apple_music_list_playlists maps library playlists once authorized', async () => {
		saveUserToken({ musicUserToken: 'utok', storefront: 'fi', savedAt: Date.now() });
		stubFetch((url) => {
			expect(url.pathname).toBe('/v1/me/library/playlists');
			return new Response(
				JSON.stringify({ data: [{ id: 'p.1', attributes: { name: 'Ajolista', trackCount: 3 } }] }),
				{ status: 200 },
			);
		});
		const result = await appleMusicListPlaylists.run({ data: {}, ...ctx });
		expect(result.output).toEqual({ playlists: [{ playlistId: 'p.1', name: 'Ajolista', trackCount: 3 }] });
	});

	test('apple_music_get_playlist combines playlist metadata and tracks', async () => {
		saveUserToken({ musicUserToken: 'utok', storefront: 'fi', savedAt: Date.now() });
		stubFetch((url) => {
			if (url.pathname.endsWith('/tracks')) {
				return new Response(
					JSON.stringify({ data: [{ id: 'i.1', attributes: { name: 'Roygbiv', artistName: 'Boards of Canada' } }] }),
					{ status: 200 },
				);
			}
			return new Response(
				JSON.stringify({ data: [{ id: 'p.1', attributes: { name: 'Ajolista', trackCount: 1 } }] }),
				{ status: 200 },
			);
		});
		const result = await appleMusicGetPlaylist.run({ data: { playlistId: 'p.1' }, ...ctx });
		expect(result.output).toEqual({
			playlist: { playlistId: 'p.1', name: 'Ajolista', trackCount: 1 },
			tracks: [{ trackId: 'i.1', name: 'Roygbiv', artistName: 'Boards of Canada' }],
		});
	});

	test('apple_music_get_playlist tolerates a 404 on an empty playlist tracks endpoint', async () => {
		saveUserToken({ musicUserToken: 'utok', storefront: 'fi', savedAt: Date.now() });
		stubFetch((url) => {
			if (url.pathname.endsWith('/tracks')) return new Response('not found', { status: 404 });
			return new Response(JSON.stringify({ data: [{ id: 'p.1', attributes: { name: 'Tyhjä' } }] }), { status: 200 });
		});
		const result = await appleMusicGetPlaylist.run({ data: { playlistId: 'p.1' }, ...ctx });
		expect(result.output).toEqual({ playlist: { playlistId: 'p.1', name: 'Tyhjä', trackCount: 0 }, tracks: [] });
	});

	test('apple_music_get_playlist throws when the playlist does not exist', async () => {
		saveUserToken({ musicUserToken: 'utok', storefront: 'fi', savedAt: Date.now() });
		stubFetch((url) => {
			if (url.pathname.endsWith('/tracks')) return new Response('not found', { status: 404 });
			return new Response(JSON.stringify({ data: [] }), { status: 200 });
		});
		await expect(appleMusicGetPlaylist.run({ data: { playlistId: 'p.missing' }, ...ctx })).rejects.toThrow(
			'ei löydy',
		);
	});

	test('apple_music_create_playlist sends attributes and initial track relationships', async () => {
		saveUserToken({ musicUserToken: 'utok', storefront: 'fi', savedAt: Date.now() });
		let sentBody: any;
		stubFetch((url, init) => {
			expect(url.pathname).toBe('/v1/me/library/playlists');
			expect(init.method).toBe('POST');
			sentBody = JSON.parse(init.body as string);
			return new Response(JSON.stringify({ data: [{ id: 'p.new', attributes: { name: 'Uusi lista' } }] }), {
				status: 200,
			});
		});
		const result = await appleMusicCreatePlaylist.run({
			data: { name: 'Uusi lista', description: 'kuvaus', trackIds: ['1', '2'] },
			...ctx,
		});
		expect(sentBody.attributes).toEqual({ name: 'Uusi lista', description: 'kuvaus' });
		expect(sentBody.relationships.tracks.data).toEqual([
			{ id: '1', type: 'songs' },
			{ id: '2', type: 'songs' },
		]);
		expect(result.output).toEqual({ playlistId: 'p.new', name: 'Uusi lista' });
	});

	test('apple_music_create_playlist omits relationships when no tracks are given', async () => {
		saveUserToken({ musicUserToken: 'utok', storefront: 'fi', savedAt: Date.now() });
		let sentBody: any;
		stubFetch((_url, init) => {
			sentBody = JSON.parse(init.body as string);
			return new Response(JSON.stringify({ data: [{ id: 'p.new', attributes: { name: 'X' } }] }), { status: 200 });
		});
		await appleMusicCreatePlaylist.run({ data: { name: 'X' }, ...ctx });
		expect(sentBody.relationships).toBeUndefined();
	});

	test('apple_music_add_tracks batches in groups of 100', async () => {
		saveUserToken({ musicUserToken: 'utok', storefront: 'fi', savedAt: Date.now() });
		let callCount = 0;
		stubFetch((_url, init) => {
			callCount++;
			const body = JSON.parse(init.body as string);
			expect(body.data.length).toBeLessThanOrEqual(100);
			return new Response(null, { status: 204 });
		});
		const ids = Array.from({ length: 150 }, (_, i) => String(i));
		const result = await appleMusicAddTracks.run({ data: { playlistId: 'p.1', trackIds: ids }, ...ctx });
		expect(result.output).toEqual({ added: 150 });
		expect(callCount).toBe(2);
	});
});
