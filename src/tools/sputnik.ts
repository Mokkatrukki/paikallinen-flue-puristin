// Flue tools wrapping the raw Sputnikmusic client (src/lib/sputnik.ts).
import { defineTool } from '@flue/runtime';
import * as v from 'valibot';
import { fetchAlbumReview, fetchBestNewMusic } from '../lib/sputnik.ts';

const BestNewMusicEntry = v.object({
	artist: v.string(),
	album: v.string(),
	url: v.string(),
});

export const sputnikListBestNewMusic = defineTool({
	name: 'sputnik_list_best_new_music',
	description:
		'Listaa Sputnikmusicin "Best New Music" -sivun tämänhetkiset albumit: artisti, albumin nimi ' +
		'ja arvostelun URL. URL kelpaa suoraan sputnik_get_album_review-kutsuun, jos haluat kappale- ' +
		'ja arvosanatiedot yksittäiseltä levyltä.',
	input: v.object({}),
	output: v.object({ albums: v.array(BestNewMusicEntry) }),
	async run() {
		const entries = await fetchBestNewMusic();
		return { output: { albums: entries } };
	},
});

const MentionedTrack = v.object({ artist: v.string(), track: v.string() });

export const sputnikGetAlbumReview = defineTool({
	name: 'sputnik_get_album_review',
	description:
		'Hae yhden albumin täysi Sputnikmusic-arvostelu URL:sta (saatu sputnik_list_best_new_musicilta). ' +
		'Palauttaa arvosanan (0-100), koko arvostelutekstin, arvostelussa mainitut kappaleet ' +
		'(artist+track-pareina — HUOM: näissä voi olla myös mainintoja muilta levyiltä, ei pelkkiä tämän ' +
		'albumin bangereita, päättele itse arvostelutekstistä mitkä ovat parhaita) ja kuuntelijoiden ' +
		'kommentteja.',
	input: v.object({ url: v.pipe(v.string(), v.minLength(1)) }),
	output: v.object({
		artist: v.string(),
		album: v.string(),
		rating: v.number(),
		reviewText: v.string(),
		mentionedTracks: v.array(MentionedTrack),
		listenerNotes: v.array(v.string()),
	}),
	async run({ data }) {
		const review = await fetchAlbumReview(data.url);
		return { output: review };
	},
});
