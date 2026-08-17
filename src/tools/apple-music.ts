// Flue tools wrapping the raw Apple Music API client (src/lib/apple-music.ts).
// One tool per action — a small local model triggers a specific, well-named
// tool more reliably than it picks the right value out of an action enum.
import { defineTool } from '@flue/runtime';
import * as v from 'valibot';
import { apiRequest, storefront } from '../lib/apple-music.ts';

const Track = v.object({
	trackId: v.string(),
	name: v.string(),
	artistName: v.string(),
	albumName: v.optional(v.string()),
});

const Playlist = v.object({
	playlistId: v.string(),
	name: v.string(),
	description: v.optional(v.string()),
	trackCount: v.optional(v.number()),
});

export const appleMusicSearchTracks = defineTool({
	name: 'apple_music_search_tracks',
	description:
		'Hae kappaleita Apple Musicin katalogista. AINA sisällytä sekä artistin nimi että kappaleen ' +
		'nimi query-parametrissa (esim. "Death Cab for Cutie Full of Stars"), ei pelkkää kappaleen ' +
		'nimeä — pelkkä yleinen kappalenimi voi osua hiljaa väärään, samannimiseen kappaleeseen ' +
		'toisella artistilla eikä palauta mitään virhettä (varmistettu livenä: hakusana "Full of ' +
		'Stars" ilman artistia palautti pelkkää ambient-musiikkia, ei Death Cab for Cutien kappaletta ' +
		'— sama haku artistin kanssa löysi oikean heti). Palauttaa track-ID:t, joita tarvitaan ' +
		'apple_music_add_tracks- ja apple_music_create_playlist-kutsuihin.',
	input: v.object({
		query: v.pipe(v.string(), v.minLength(1)),
		limit: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(25)), 10),
	}),
	output: v.object({ tracks: v.array(Track) }),
	async run({ data }) {
		const res = await apiRequest(`/catalog/${storefront()}/search`, {
			params: { term: data.query, types: 'songs', limit: data.limit ?? 10 },
		});
		const items: any[] = res.results?.songs?.data ?? [];
		return {
			output: {
				tracks: items.map((t) => ({
					trackId: t.id,
					name: t.attributes?.name ?? '',
					artistName: t.attributes?.artistName ?? '',
					albumName: t.attributes?.albumName ?? undefined,
				})),
			},
		};
	},
});

export const appleMusicListPlaylists = defineTool({
	name: 'apple_music_list_playlists',
	description:
		'Listaa käyttäjän Apple Music -kirjaston KAIKKI soittolistat (sivuttaa automaattisesti — ei ' +
		'katkea 100 kappaleeseen). HUOM: tämä endpoint ei palauta kappalemäärää (Applen API ei sisällä ' +
		'sitä listausvastauksessa, verified live) — trackCount on aina tyhjä täältä, hae se erikseen ' +
		'apple_music_get_playlistilla jos tarvitset sen yhdelle listalle. Käytä tätä AINA ennen ' +
		'apple_music_create_playlistia kun tarkoitus on löytää-tai-luo nimellä — muuten vanha ' +
		'samanniminen lista voi jäädä huomaamatta ja syntyy duplikaatti (tapahtui livenä kun soittolistoja ' +
		'oli yli 100 eikä sivutusta ollut).',
	input: v.object({}),
	output: v.object({ playlists: v.array(Playlist) }),
	async run() {
		const items: any[] = [];
		const pageSize = 100;
		for (let offset = 0; ; offset += pageSize) {
			const res = await apiRequest('/me/library/playlists', {
				params: { limit: pageSize, offset },
				requireUserToken: true,
			});
			const page: any[] = res.data ?? [];
			items.push(...page);
			if (page.length < pageSize) break;
		}
		return {
			output: {
				playlists: items.map((p) => ({
					playlistId: p.id,
					name: p.attributes?.name ?? '',
					description: p.attributes?.description?.standard ?? undefined,
					trackCount: p.attributes?.trackCount ?? undefined,
				})),
			},
		};
	},
});

export const appleMusicGetPlaylist = defineTool({
	name: 'apple_music_get_playlist',
	description: 'Hae yhden soittolistan tiedot ja sen kappaleet järjestyksessä.',
	input: v.object({ playlistId: v.pipe(v.string(), v.minLength(1)) }),
	output: v.object({ playlist: Playlist, tracks: v.array(Track) }),
	async run({ data }) {
		const [playlistRes, tracksRes] = await Promise.all([
			apiRequest(`/me/library/playlists/${data.playlistId}`, { requireUserToken: true }),
			apiRequest(`/me/library/playlists/${data.playlistId}/tracks`, {
				params: { limit: 100 },
				requireUserToken: true,
			}).catch(() => ({ data: [] })), // an empty playlist's /tracks endpoint 404s
		]);
		const p = playlistRes.data?.[0];
		if (!p) throw new Error(`Soittolistaa ${data.playlistId} ei löydy.`);
		const tracks: any[] = tracksRes.data ?? [];
		return {
			output: {
				playlist: {
					playlistId: p.id,
					name: p.attributes?.name ?? '',
					description: p.attributes?.description?.standard ?? undefined,
					trackCount: p.attributes?.trackCount ?? tracks.length,
				},
				tracks: tracks.map((t) => ({
					trackId: t.id,
					name: t.attributes?.name ?? '',
					artistName: t.attributes?.artistName ?? '',
					albumName: t.attributes?.albumName ?? undefined,
				})),
			},
		};
	},
});

export const appleMusicCreatePlaylist = defineTool({
	name: 'apple_music_create_playlist',
	description:
		'Luo uusi soittolista Apple Music -kirjastoon. Anna kappaleiden track-ID:t heti mukaan jos ' +
		'ne on jo haettu apple_music_search_tracksilla — säästää yhden erillisen add_tracks-kutsun. ' +
		'HUOM: Apple Music -rajapinta ei tue soittolistan poistoa, nimeämistä uudelleen eikä ' +
		'yksittäisen kappaleen poistoa — vain luonti ja kappaleiden lisäys ovat mahdollisia. ' +
		'Mieti nimi ja sisältö siis valmiiksi, koska sitä ei voi enää muuttaa API:n kautta jälkikäteen.',
	input: v.object({
		name: v.pipe(v.string(), v.minLength(1)),
		description: v.optional(v.string()),
		trackIds: v.optional(v.array(v.string())),
	}),
	output: v.object({ playlistId: v.string(), name: v.string() }),
	async run({ data }) {
		const attributes: Record<string, unknown> = { name: data.name };
		if (data.description) attributes.description = data.description;
		const body: Record<string, unknown> = { attributes };
		if (data.trackIds?.length) {
			body.relationships = {
				tracks: { data: data.trackIds.map((id) => ({ id, type: 'songs' })) },
			};
		}
		const res = await apiRequest('/me/library/playlists', {
			method: 'POST',
			body,
			requireUserToken: true,
		});
		const p = res.data?.[0];
		if (!p) throw new Error('Soittolistan luonti epäonnistui.');
		return { output: { playlistId: p.id, name: p.attributes?.name ?? data.name } };
	},
});

export const appleMusicAddTracks = defineTool({
	name: 'apple_music_add_tracks',
	description: 'Lisää kappaleita soittolistan loppuun track-ID:llä. Apple Music ei tue sijainnin valintaa — uudet kappaleet menevät aina viimeiseksi.',
	input: v.object({
		playlistId: v.pipe(v.string(), v.minLength(1)),
		trackIds: v.pipe(v.array(v.string()), v.minLength(1)),
	}),
	output: v.object({ added: v.number() }),
	async run({ data }) {
		let added = 0;
		for (let i = 0; i < data.trackIds.length; i += 100) {
			const batch = data.trackIds.slice(i, i + 100);
			await apiRequest(`/me/library/playlists/${data.playlistId}/tracks`, {
				method: 'POST',
				body: { data: batch.map((id) => ({ id, type: 'songs' })) },
				requireUserToken: true,
			});
			added += batch.length;
		}
		return { output: { added } };
	},
});

// No rename/delete-playlist or remove-track tool: verified live against the
// real API (2026-08-16) that PATCH, PUT, and DELETE against
// /me/library/playlists and its /tracks sub-resource all return a bare 401
// for a standard (non-organizational) MusicKit developer token — same
// developer + user token that POST (create/add) accepts without issue.
// This is a documented Apple platform limitation, not a bug here: see
// https://developer.apple.com/forums/thread/107807 and
// https://developer.apple.com/forums/thread/813068. Third-party apps can
// only create playlists and append tracks; renaming, deleting, and removing
// individual tracks are not possible through the Apple Music API at all —
// only from the Music app itself.
