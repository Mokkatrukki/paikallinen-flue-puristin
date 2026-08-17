# SPEC

## §G
Viikoittain löytää hyviä uusia levyjä (Sputnikmusic best-new-music) ja tuoda niiden bangerit Apple Music -soittolistalle.

## §C
- Ei valmiita kirjastoja (vision: kaikki rakennetaan itse) — HTML parsitaan käsin kirjoitetulla regex/string-poiminnalla, ei cheerio/jsdom tms.
- Rating normalisoidaan 0-100 skaalalle (Sputnikin oma skaala esim 4.3/5 skaalataan ylös).
- Tool-rakenne: `src/lib/<service>.ts` raaka client, `src/tools/<service>.ts` ohuet defineTool-wrapperit, ks. `src/lib/apple-music.ts` / `src/tools/apple-music.ts` esimerkkinä.
- Vain paikallinen Gemma-malli käytössä (ei cloud-API:a) — jos joku vaihe tarvitsee LLM-extraktiota, käytä olemassa olevaa Gemma-agenttia.
- Mocked unit-testit clientille (ks. `tests/apple-music.test.ts`), live-model-todiste että Gemma osaa kutsua toolia oikein.

## §T
T1|x|pfp-fluetools|src/lib/sputnik.ts: raaka fetch + HTML-siivous (nav/sidebar/mainokset pois) sputnikmusic.com/bestnewmusic -sivulle. src/tools/sputnik.ts: `sputnik_list_best_new_music` -> `{artist, album, url}[]`. Regex/string-poiminta, ei ready-made HTML-parseria.
T2|x|pfp-fluetools|src/tools/sputnik.ts: `sputnik_get_album_review(url)` -> `{artist, album, rating, reviewText, mentionedTracks[], listenerNotes[]}`. Poikkesi alkuper. specistä: standoutTracks[] vaihdettu mentionedTracks[]:ksi (kaikki maininnat, filtteröimättä) + reviewText, koska "mikä on banger" vaatii tulkintaa jota regex ei tee — käyttäjän päätös T2-ajon aikana: Gemma tulkitsee tekstin keskustelun aikana, tool pysyy deterministisenä.

## §B
(tyhjä)
