# SPEC

## §G
Viikoittain löytää hyviä uusia levyjä (Sputnikmusic best-new-music) ja tuoda niiden bangerit Apple Music -soittolistalle.

## §C
- Ei valmiita kirjastoja (vision: kaikki rakennetaan itse) — HTML parsitaan käsin kirjoitetulla regex/string-poiminnalla, ei cheerio/jsdom tms.
- Rating normalisoidaan 0-100 skaalalle (Sputnikin oma skaala esim 4.3/5 skaalataan ylös).
- Tool-rakenne: `src/lib/<service>.ts` raaka client, `src/tools/<service>.ts` ohuet defineTool-wrapperit, ks. `src/lib/apple-music.ts` / `src/tools/apple-music.ts` esimerkkinä.
- Tuotanto-agentti on vain paikallinen Gemma-malli (ei cloud-API:a). Poikkeus: pfp-flueagents saa käyttää Claudea testausoraakkelina (ajaa saman flow'n referenssituloksen tuottamiseksi, jota Gemman tulosta vasten verrataan) — itse tuotantoajo pysyy aina Gemmalla.
- Mocked unit-testit clientille (ks. `tests/apple-music.test.ts`), live-model-todiste että Gemma osaa kutsua toolia oikein.
- Soittolistan nimikäytäntö: EI enää yksi kiinteä nimi ("New Music Weekly") jota käytetään uudelleen. Jokainen agenttiajo (yhden erän albumeita, esim. 3 kpl) luo AINA UUDEN soittolistan juoksevalla numerolla, esim. "New Music #12" → seuraava ajo "New Music #13". Käyttäjä poistaa vanhoja listoja käsin sitä mukaa kun kuuntelee. Numero pääteltävä olemassa olevista listoista (apple_music_list_playlists, poimi suurin "New Music #N" ja jatka N+1:stä).

T3|x|pfp-fluetools|Vaihda src/agents/gemma.ts:n soittolista-osuus find-or-create-by-fixed-name -kuviosta (nykyinen, "New Music Weekly") aina-uusi-numeroitu-soittolista -kuvioon. Flow: (1) sputnik_list_best_new_music, (2) per albumi sputnik_get_album_review + poimi 1-2 eksplisiittisesti ylistettyä kappaletta (sääntö jo promptissa), (3) apple_music_search_tracks jokaiselle poimitulle kappaleelle, (4) apple_music_list_playlists, etsi kaikki nimeltään "New Music #<n>" olevat listat ja poimi suurin n (0 jos ei yhtään), (5) apple_music_create_playlist nimellä "New Music #<n+1>" + kaikki tämän ajon löytämät track-ID:t kerralla. Ei enää apple_music_add_tracks-haaraa tässä flow'ssa — joka ajo tekee aina uuden listan, ei koskaan lisää vanhaan. Päivitä myös LEARNINGS.md-viittaus jos promptin kommentit viittaavat vanhaan "reuse by name" -logiikkaan. Ei vielä live-ajoa tässä taskissa — T4 hoitaa sen.

T4|x|pfp-flueagents|Testaa flow (sputnik-lista → review-poiminta → Apple Music -haku → uusi numeroitu soittolista, T3:n toteuttamana) skaalaavalla loopilla, pienimmästä alkaen: ensimmäinen todiste on YKSI albumi jonka 1-2 poimittua kappaletta päätyvät oikein UUTEEN numeroituun soittolistaan (ei koko 3 albumin erää vielä) — vasta kun tämä pienin askel on vahvistettu, laajenna 3 albumin erään. Kummallakin tasolla: ensin aja Claudella testausoraakkelina (vertailutulos: kappaleet/soittolistan nimi oikein), sitten sama live-ajo paikallisella Gemmalla ja vertaa. Vahvista erikseen että soittolistan numerointi menee oikein myös kun kirjastossa on jo useita "New Music #N" -listoja (paginaatio-bugi oli jo kertaalleen syy T3-jumiin, ks. LEARNINGS.md — testaa ettei toistu). Kysy käyttäjältä ennen live-Gemma-ajoa (pysyvä kirjoitus oikeaan Apple Music -kirjastoon, ei rollbackia). Kirjaa löydökset LEARNINGS.md:hen.

## §B
B1|2026-08-17|Idea, ei vielä speksattu: rinnakkainen output Apple Music -soittolistan LISÄKSI — genrellä ryhmitelty sivu/tietokanta ("uudet pop levyt viikolle" -tyyppiset ryhmät, muutama levy per ryhmä, muutama kappale per levy, linkki levylle + lyhyt "miksi tämä on kova" -teksti per levy). Genre päätellään lopulta oikeasta rajapinnasta (ei Gemman päättelemänä, käyttäjä täsmensi), mutta Gemmalta halutaan lisäksi niche-tyylisiä genre/vibe-kuvauksia tekstistä. Tallennus aloitetaan pienestä (käyttäjä mainitsi mahdollisen tietokannan myöhemmin, ei heti). Tulevaisuudessa: useampi lähdejärjestelmä samalle datalle, saman albumin toistuminen useasta lähteestä nostaisi sen esiin ("hyvä syystä X" -korostus). Ei vielä auki: mistä rajapinnasta genre haetaan, tietokannan muoto, sivun tarkka rakenne — nämä pitää grillata ennen kuin tästä kirjoitetaan §T-taskeja.

Tutkimuslöydös (2026-08-17, 3 arvostelusivua tarkastettu — Sallow Moth, Marilyn Manson, Ripper (CL) — sama kaava kaikissa): Sputnikin arvostelusivulla on 4 rakenteellisesti poimittavaa kenttää joita `sputnik_get_album_review` ei vielä palauta, regexillä ilman LLM:ää:
- **Review Summary** (`Review Summary:</b> TEKSTI`) — arvostelijan itse kirjoittama yhden lauseen hook, käy suoraan "miksi tämä on kova" -blurbiksi ilman Gemman tulkintaa (esim. "Beautiful evil, hail to darkness").
- **Canonical review-linkki** (`<link rel="canonical" href="...">`, muotoa `/review/<id>/...`) — eri URL kuin nyt käytetty `/album/<id>/...` fetch-URL, tämä on se "oikea" linkki arvosteluun sivulle näytettäväksi.
- **Arvostelija** (`<a href=/user/USERNAME>Näyttönimi</a>`).
- **Arvostelun päivämäärä** (tekstimuotoa "August 16th, 2026 |").

Kun B1 grillataan, nämä 4 kenttää ovat valmis ehdokas `sputnik_get_album_review`-outputin laajennukseksi (pieni pfp-fluetools-task) — genre/vibe jää edelleen erikseen ratkaistavaksi (joko oikea rajapinta tai Gemman niche-päättely, ei kumpikaan vielä päätetty).
