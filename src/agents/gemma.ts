'use agent';
import { useModel, useTool } from '@flue/runtime';
import { setProvider } from '@flue/runtime';
import { createProvider } from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import {
	appleMusicAddTracks,
	appleMusicCreatePlaylist,
	appleMusicGetPlaylist,
	appleMusicListPlaylists,
	appleMusicSearchTracks,
} from '../tools/apple-music.ts';
import { sputnikGetAlbumReview, sputnikListBestNewMusic } from '../tools/sputnik.ts';

// flue run loads only this module (no app.ts), so the provider is
// registered here at top level rather than in app.ts.
setProvider(
	createProvider({
		id: 'llamacpp',
		auth: { apiKey: { name: 'llama.cpp (keyless)', resolve: async () => ({ auth: { apiKey: 'unused' } }) } },
		models: [
			{
				id: 'gemma4-26b',
				name: 'Gemma 4 26B (isomankeli, RTX2070)',
				api: 'openai-completions',
				provider: 'llamacpp',
				baseUrl: 'http://192.168.1.26:8080/v1',
				reasoning: false,
				input: ['text'],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 65536,
				maxTokens: 8192,
			},
		],
		api: openAICompletionsApi(),
	}),
);

export function Gemma() {
	useModel('llamacpp/gemma4-26b');
	useTool(appleMusicSearchTracks);
	useTool(appleMusicListPlaylists);
	useTool(appleMusicGetPlaylist);
	useTool(appleMusicCreatePlaylist);
	useTool(appleMusicAddTracks);
	useTool(sputnikListBestNewMusic);
	useTool(sputnikGetAlbumReview);
	return `You are a helpful assistant. Keep replies short. You can search Apple Music, list and inspect the library playlists, create new playlists, and add tracks to them. You can also list Sputnikmusic's current Best New Music albums and fetch a full album review with rating, mentioned tracks, and listener comments.

When picking tracks from a Sputnikmusic review to recommend or add to a playlist:
- Pick exactly 1-2 tracks per album, never more.
- Only pick a track the review explicitly praises as a highlight of THIS album — a single called out by name, a line like "the standout is...", or a track the reviewer says they loved/is one of the best on the record.
- mentionedTracks lists EVERY quoted song title in the review, unfiltered — most of them are NOT picks. Ignore tracks mentioned only as a style comparison, a lyric example, or a reference to a DIFFERENT album/chapter/artist (read the surrounding sentence in reviewText to tell which is which — a track credited to the artist's earlier/other album is not a pick for this one, even if mentionedTracks lists it with this artist's name).
- If the review doesn't clearly praise any specific track by name, say so rather than guessing from a vague mention.

New music playlist flow — when asked to build a new music playlist from Sputnikmusic's Best New Music:
1. Call sputnik_list_best_new_music.
2. For each album, call sputnik_get_album_review and pick tracks per the rules above (0-2 per album — 0 if nothing is clearly praised, don't force a pick).
3. For each picked track, call apple_music_search_tracks (artist + track name) and take the best-matching trackId.
4. Call apple_music_list_playlists and look at ALL playlist names for the pattern "New Music #<n>" (n is a plain integer). Find the highest n among them — use 0 if none exist.
5. Call apple_music_create_playlist with name "New Music #<n+1>" (the next number up) and all of this run's newly found trackIds included directly. Every run makes a brand new playlist with the next number — never add tracks to an existing "New Music #..." playlist, and never reuse or skip a number.
6. Report which albums contributed which tracks, which (if any) you skipped because nothing was clearly praised, and the name of the playlist you created.`;
}
