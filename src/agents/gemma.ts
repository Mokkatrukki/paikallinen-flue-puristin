'use agent';
import { useModel, useSubagent, useTool } from '@flue/runtime';
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

// Processes ONE album end-to-end (review -> pick -> search -> add) in its own
// fresh context. Keeping this isolated is what lets the parent process many
// albums in a single run without the full review text of every album piling
// up in the parent's context window — the parent only ever sees this
// subagent's short final summary, never the reviewText it worked from.
// Track IDs never cross back into the parent as text either: this subagent
// adds them straight to the target playlist itself, so there's nothing for
// the parent to mistranscribe.
function AlbumPicker() {
	useTool(sputnikGetAlbumReview);
	useTool(appleMusicSearchTracks);
	useTool(appleMusicAddTracks);
	return `You process EXACTLY ONE album for a "new music" playlist — never more, even if the task prompt lists several. You'll be given one album's artist, album title, its Sputnikmusic review URL, and an Apple Music playlistId that already exists — your job is to add this one album's best tracks (if any) to that playlist. If the task prompt describes more than one album, process only the first one it names and say so in your reply — do not loop through the rest yourself; the parent is responsible for giving you one task per album.

1. Call sputnik_get_album_review with the given URL.
2. Pick up to 2 tracks the review explicitly praises as a highlight of THIS album — a single called out by name, a line like "the standout is...", or a track the reviewer says they loved/is one of the best on the record. mentionedTracks lists EVERY quoted song title in the review unfiltered, most of them are NOT picks — read reviewText to tell which ones are real praise of this album's own tracks (not a style comparison, a lyric example, or a track from a DIFFERENT album/chapter). If the review doesn't clearly praise any specific track by name, pick 0 — don't force a pick from a vague mention.
3. For each picked track, call apple_music_search_tracks (artist + track name, both always included). Check that the returned "name" and "artistName" fields actually correspond to the track you searched for — a result for an unrelated song or artist is NOT a match even as the top hit. If it doesn't match, retry once with a simplified query (e.g. drop a parenthetical qualifier like "(CL)" from the artist name, or drop minor words from the track title). If it still doesn't match, drop that track — do not substitute a different song.
4. If you found any trackIds, call apple_music_add_tracks with the given playlistId and those trackIds. If you found none, don't call it at all.
5. Reply with ONLY a short summary: which track(s) you added (by name), or that none qualified / none were found on Apple Music, and why. No other commentary.`;
}

export function Gemma() {
	useModel('llamacpp/gemma4-26b');
	useTool(appleMusicSearchTracks);
	useTool(appleMusicListPlaylists);
	useTool(appleMusicGetPlaylist);
	useTool(appleMusicCreatePlaylist);
	useTool(appleMusicAddTracks);
	useTool(sputnikListBestNewMusic);
	useTool(sputnikGetAlbumReview);
	useSubagent({
		name: 'album_picker',
		description:
			'Processes ONE album for the new-music playlist: fetches its Sputnikmusic review, picks up to 2 explicitly-praised ' +
			'tracks, finds them on Apple Music, and adds them straight to a given playlistId. Give it exactly ONE album (artist, ' +
			'title, review URL, target playlistId) per task call — it will refuse to process more than one even if you list ' +
			'several in the prompt. For N albums, make N separate task tool calls (one per album), all in the same turn so they ' +
			'run in parallel — never describe multiple albums inside a single task call, that serializes them into one ' +
			"subagent's context instead of running them independently and risks it running out of room before the last one.",
		agent: AlbumPicker,
	});
	return `You are a helpful assistant. Keep replies short. You can search Apple Music, list and inspect the library playlists, create new playlists, and add tracks to them. You can also list Sputnikmusic's current Best New Music albums and fetch a full album review with rating, mentioned tracks, and listener comments.

New music playlist flow — when asked to build a new music playlist from Sputnikmusic's Best New Music (for one album or many):
1. Call sputnik_list_best_new_music.
2. Call apple_music_list_playlists and look at ALL playlist names for the pattern "New Music #<n>" (n is a plain integer). Find the highest n among them — use 0 if none exist.
3. Call apple_music_create_playlist with name "New Music #<n+1>" (the next number up) and no tracks yet — you need its playlistId before delegating. Every run makes a brand new playlist with the next number — never add to an existing "New Music #..." playlist, never reuse or skip a number.
4. For every album to process, dispatch a SEPARATE task tool call to the album_picker subagent, ONE call per album — give each call only that one album's artist, album title, review URL, and the playlistId from step 3. If you are processing N albums, that is N separate task calls, all issued in this same turn so they run in parallel. Never combine more than one album's info into a single task call. Do not fetch or read reviews yourself, that's entirely the subagent's job.
5. Once all tasks return, report per album what was added (or why nothing was), and the name of the playlist you created. If a subagent reports a track wasn't found on Apple Music, call that out by name so it can be added manually.`;
}
