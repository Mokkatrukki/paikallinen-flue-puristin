// Manual, one-off live check against the real Apple Music API. Not a test
// suite — proves the tools that can work do work. Run: bun scripts/live-roundtrip-check.ts
//
// Leaves behind one playlist named "flue live check" — Apple's API has no
// delete/rename support (see src/tools/apple-music.ts), so clean it up by
// hand in the Music app if you don't want it.
import {
	appleMusicAddTracks,
	appleMusicCreatePlaylist,
	appleMusicGetPlaylist,
	appleMusicListPlaylists,
	appleMusicSearchTracks,
} from '../src/tools/apple-music.ts';

const ctx = { signal: new AbortController().signal, log: console, toolCallId: 'live-check' } as any;

async function main() {
	console.log('1. search_tracks...');
	const search = await appleMusicSearchTracks.run({ data: { query: 'Portishead Glory Box', limit: 3 }, ...ctx });
	const trackA = search.output!.tracks[0];
	if (!trackA) throw new Error('haku ei palauttanut mitään');
	console.log(`   → ${trackA.name} — ${trackA.artistName} (${trackA.trackId})`);

	const search2 = await appleMusicSearchTracks.run({ data: { query: 'Boards of Canada Roygbiv', limit: 3 }, ...ctx });
	const trackB = search2.output!.tracks[0];
	if (!trackB) throw new Error('toinen haku ei palauttanut mitään');
	console.log(`   → ${trackB.name} — ${trackB.artistName} (${trackB.trackId})`);

	console.log('\n2. create_playlist (yhden kappaleen kanssa)...');
	const created = await appleMusicCreatePlaylist.run({
		data: { name: 'flue live check', description: 'apple-music-toolien koeajo', trackIds: [trackA.trackId] },
		...ctx,
	});
	const playlistId = created.output!.playlistId;
	console.log(`   → luotu ${created.output!.name} (${playlistId})`);

	console.log('\n3. add_tracks...');
	const added = await appleMusicAddTracks.run({ data: { playlistId, trackIds: [trackB.trackId] }, ...ctx });
	console.log(`   → lisätty ${added.output!.added} kpl`);

	console.log('\n4. get_playlist (pitäisi näyttää 2 kpl)...');
	const got = await appleMusicGetPlaylist.run({ data: { playlistId }, ...ctx });
	console.log('  ', got.output!.tracks.map((t) => `${t.name} — ${t.artistName}`));
	if (got.output!.tracks.length !== 2) throw new Error(`odotettiin 2 kappaletta, saatiin ${got.output!.tracks.length}`);

	console.log('\n5. list_playlists (pitäisi sisältää juuri luotu — kirjasto propagoi hetken, retrytään)...');
	let found: { name: string; trackCount?: number } | undefined;
	for (let attempt = 0; attempt < 5 && !found; attempt++) {
		if (attempt > 0) await new Promise((r) => setTimeout(r, 2000));
		const list = await appleMusicListPlaylists.run({ data: {}, ...ctx });
		found = list.output!.playlists.find((p) => p.playlistId === playlistId);
	}
	if (!found) throw new Error('juuri luotua soittolistaa ei löytynyt list_playlists-tuloksesta 5 yrityksen jälkeen');
	console.log(`   → löytyi: ${found.name} (${found.trackCount} kpl)`);

	console.log('\nKAIKKI OK — search / create / add / get / list toimivat oikeaa Apple Music APIa vasten.');
	console.log(`Testisoittolista "flue live check" (${playlistId}) jäi kirjastoon — poista käsin Music-sovelluksesta jos ei tarvita.`);
}

main().catch((e) => {
	console.error('\nEPÄONNISTUI:', e);
	process.exit(1);
});
