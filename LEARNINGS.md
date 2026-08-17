# Oppeja: Flue, työkalusuunnittelu ja pieni paikallinen malli

Muistiinpanoja siitä miten tämä projekti rakennettiin ja miten Gemma 4 26B (paikallinen,
isomankeli) pärjäsi sille annetuissa tehtävissä. Kirjoitettu Sputnikmusic-integraation
(`src/lib/sputnik.ts`, `src/tools/sputnik.ts`) rakentamisen ja sen live-testauksen pohjalta.

## Flue-tason opit

**Kaksi tiedostoa per palvelu, ei yhtä.** `src/lib/<service>.ts` (raaka client: fetch, auth,
virheenkäsittely) ja `src/tools/<service>.ts` (ohuet `defineTool`-wrapperit). Bugit asuvat
lähes aina client-puolella — se on myös se osa jota testaa mockatulla `fetch`:illä ilman
elävää mallia. Tool-kerros on tarkoituksella liian yksinkertainen bugatakseen itse.

**Yksi tool per toiminto, ei enum-parametria.** Pieni paikallinen malli valitsee luotettavammin
oikean, hyvin nimetyn toolin listasta kuin poimii oikean arvon enum-parametrin sisältä. Tämä
näkyi suoraan: Gemma valitsi `sputnik_list_best_new_music` → `sputnik_get_album_review`
-ketjun oikein joka kerta, ilman sekaannusta.

**Live-acceptance-testi on se joka oikeasti todistaa jotain.** Typecheck ja mockatut testit
todistavat että koodi on sisäisesti johdonmukaista — vasta `npx flue run` oikealla promptilla
todistaa että pieni malli löytää ja käyttää toolia oikein. Kaksi konkreettista löytöä jotka
vain live-ajo paljasti:
- Sputnikin arvostelusivuilla on kaksi eri lainausmerkkityyliä kappalenimille (`“tupla”` vs.
  `‘yksittäinen’`) — regex nappaa vain toisen, jolloin `mentionedTracks` on välillä täysin
  tyhjä. Ei näkynyt yhdestä testisivusta, näkyi kun testattiin useampaa albumia.
- HTML-rakenteen oletus (attribuuttien järjestys `<a>`-tagissa) piti tarkistaa oikeasta
  sivusta kahdesti — ensimmäinen regex kommenteille ei osunut, koska `href` ei ollutkaan
  ensimmäinen attribuutti.

**Deterministinen tool + tulkitseva agentti, ei kumpaakaan yksin.** `sputnik_get_album_review`
palauttaa raakadatan (koko arvosteluteksti + kaikki mainitut kappaleet, filtteröimättä) —
tulkinta ("mikä kappale on oikeasti hyvä") jätettiin agentille system-promptin ohjeistuksella.
Tool pysyy yksinkertaisena ja testattavana; semanttinen päättely menee sinne missä sille on
työkalut (malli, ei regex).

## Miten Gemma pärjäsi

**Tool-valinta: täydellinen.** Jokaisessa testatussa promptissa (4 kpl, eri albumeilla) Gemma
valitsi oikean toolin oikeassa järjestyksessä ja välitti sille URL:n oikein edellisen
tool-kutsun tuloksesta ilman ohjausta.

**Kappalepoiminta arvostelutekstistä: 5/6 osumaa asiantuntija-arvioon.** Kun promptiin
lisättiin selkeä sääntö ("vain eksplisiittisesti ylistetty kappale, max 2, älä nojaa
`mentionedTracks`-kenttään sellaisenaan"), Gemma poimi neljästä testialbumista täsmälleen
samat kappaleet kuin itse päädyin lukemalla arvostelut käsin — kolmessa albumissa 2/2, yhdessä
1/2 (rajatapaus, molemmat perusteltavissa tekstistä: "catchy as hell" vs. "ranks among the
most gorgeous... in their entire catalogue" — kumpikaan ei ollut väärä poiminta, vain eri
painotus).

**Osasi tunnistaa epäluotettavan datan.** Boards of Canada -arvostelussa `mentionedTracks`
sisälsi selvää roskaa (regex nappasi lainausmerkeissä olevan vertailufraasin "Geogaddi 2"
kappalenimenä). Gemma huomasi tämän itse ("the mentionedTracks list is actually very
poor/incorrect") ja siirtyi lukemaan `reviewText`-kenttää suoraan — juuri niin kuin
system-promptissa ohjeistettiin, ei kovakoodattua sääntöä siihen tapaukseen.

**Ennen promptin tarkennusta vs. jälkeen.** Ensimmäisellä yrityksellä (löysä prompti,
`standoutTracks`-sana käytössä) Gemma palautti 7 kappaletta 14:sta maininnasta yhdeltä
levyltä — mukana virhe (poimi kappaleen joka kuului levyn edelliseen osaan, ei arvosteltavaan
albumiin). Yksi tarkka system-prompti-lisäys (max 1-2, vain eksplisiittinen ylistys, huomioi
minkä albumin kappale on) korjasi tämän kokonaan seuraavissa ajoissa. Pieni malli ei
kompensoi epätarkkaa ohjeistusta arvaamalla oikein — se tekee tarkalleen mitä ohje sallii.

## pfp-*-skillien hallinta

`pfp-pm` (spec + dispatch) → `pfp-fluetools` (build + test + live-todiste) -kaksijako piti
vastuut selkeinä koko ajan: pfp-pm ei koskaan kirjoittanut koodia, pfp-fluetools ei koskaan
päättänyt mitä rakennetaan. SPEC.md:n §T-rivit (`id|status|skill|task`) toimivat baton'ina
ilman että kumpikaan skilli tarvitsi muuta kontekstia kuin sen oman taskin tekstin ja
relevantit §C-rajoitteet.

Kolmas skilli, `pfp-flueagents`, lisättiin kun huomattiin ettei kumpikaan yllä oleva omista
"toimiiko agentti luotettavasti" -kysymystä: pfp-fluetools todistaa yhden toolin toimivan,
pfp-pm ei koskaan testaa itse. pfp-flueagents omistaa moniosaisen agentti-flow'n
luotettavuuden — pienestä isompaan skaalaavan testiloopin, ja tämän tiedoston kirjoittamisen.

## Debug-kierrokset (pfp-flueagents)

### 2026-08-17 — T3: sputnik→Apple Music-täysi flow, 3 albumia

**Testattu:** yhden agentin (`Gemma()`, 7 toolia mountattuna) kyky ketjuttaa
list→review→poiminta→haku→find-or-create-playlist täysin itsenäisesti, kasvattaen
kompleksisuutta askel kerrallaan (pelkkä review-haku → +Apple Music-haku → +playlist-kirjoitus).

**Mikä hajosi #1 — Death Cab -arvostelun haku epäonnistui 4 albumin ajossa.**
Ensimmäinen teoria (väärä): konteksti-ikkuna/tiivistys hukkasi tiedon. Kun asiaa selvitettiin
(ks. Flue-docs `reference/agent-behavior`), kontekstin koko oli itse asiassa oikein
mitoitettu eikä misconfigia löytynyt — teoria ei kestänyt tarkastelua.
**Oikea juurisyy:** `src/lib/sputnik.ts fetchHtml()` ei retrynnyt kertaakaan transienttia
verkkovirhettä/5xx:ää — yksittäinen katkos yhden sivulatauksen kohdalla kaatoi koko
tool-kutsun. **Fix:** lisätty retry (verkkovirhe, 429, 5xx) samalla kuviolla kuin
apple-music.ts:n 401/429-retryssä. **Vahvistettu vakaaksi:** 3/3 arvostelun haku onnistui
kolmella peräkkäisellä ajolla korjauksen jälkeen, myös rinnakkaiskutsuina.

**Mikä hajosi #2 — Apple Music -soittolistasta syntyi duplikaatti.** Täydessä flow-ajossa
`apple_music_create_playlist` loi UUDEN "New Music Weekly" -listan vaikka yksi oli jo
olemassa. **Juurisyy:** `apple_music_list_playlists` käytti kovakoodattua `limit: 100` ilman
sivutusta — käyttäjän kirjastossa on 224 soittolistaa, joten find-or-create-by-name-logiikka
ei koskaan nähnyt vanhaa listaa sivun ulkopuolella. Ei korjattavissa jälkikäteen: Apple Music
-API ei tue soittolistan poistoa (ks. AGENTS.md) — duplikaatti jäi käyttäjän poistettavaksi
käsin. **Fix:** `apple_music_list_playlists` paginoi nyt kaikki sivut loppuun (offset-looppi
kunnes sivu palauttaa vähemmän kuin pageSize). **Vahvistettu vakaaksi:** live-ajolla debug-
logituksella nähtiin 3 sivua/224 tulosta haettuna oikein, mockattu testi lisätty (yli 100
tuloksen sivutus) pysyväksi regressiosuojaksi.

**Mikä oli hauras muttei vielä rikki — Apple Music -haku ilman artistin nimeä.**
Suora testi (`appleMusicSearchTracks.run` ohi Gemman) paljasti: haku "Full of Stars" ilman
artistia palautti pelkkää ambient-musiikkia, ei Death Cab for Cutien kappaletta — sama haku
artistin kanssa löysi oikean heti, top-tulos 6/6 testatussa haussa. Gemma on aina käytännössä
hakenut artisti+kappale-yhdistelmällä, joten tämä ei ole vielä oikeasti kaatanut mitään, mutta
on hiljainen väärä-tulos-riski jos malli joskus jättää artistin pois. **Fix (ennaltaehkäisevä):**
`apple_music_search_tracks`-toolin `description` vaatii nyt eksplisiittisesti artistin+kappaleen
yhdessä, perusteluineen (real esimerkki mukana kuvauksessa, ei pelkkä MUST-sana).

**Malli ei ole deterministinen samalla promptilla.** Marilyn Manson -arvostelulle Gemma antoi
eri ajokerroilla 0 tai 2 poimittua kappaletta samalla system-promptilla ja samalla
arvostelutekstillä — molemmat tulkinnat perusteltavissa tekstistä (rajatapaus: "adulation for
Antichrist Superstar... modern and mature interpretation" on rajalla eksplisiittisen ylistyksen
ja pelkän kuvailun välillä). Ei bugi, mutta jos tarkkaa toistettavuutta halutaan, `useModel`-
kutsuun kannattaisi kokeilla `temperature: 0` -tyyppistä asetusta (ei vielä kokeiltu).

**Debug-työkalu joka jäi pysyväksi.** `PFP_DEBUG=1`-ympäristömuuttuja lisättiin sekä
`src/lib/apple-music.ts`:ään että `src/lib/sputnik.ts`:ään — tulostaa jokaisen HTTP-pyynnön ja
statuksen stderr:iin. Ilman tätä molemmat juurisyyt (#1 ja #2) olisi jouduttu arvaamaan
Gemman transkriptin perusteella, mikä johti alkuun väärään context-limit-teoriaan. Aina kun
jotain "epäonnistuu" agentin transkriptissä ilman selkeää syytä, aja sama live-testi
`PFP_DEBUG=1`:llä ennen kuin teoretisoit syytä.

### 2026-08-17 — T4: numeroitu-soittolista-flow, 1 albumi

**Testattu:** T3:n muutoksen (fixed-name "New Music Weekly" reuse → aina uusi
"New Music #<n+1>" per ajo) pienin mahdollinen askel — yksi albumi (Kevin Morby, *Little Wide
Open*), 1-2 poimittua kappaletta, uusi numeroitu soittolista.

**Claude-oraakkeli vs. Gemma:** luin arvostelun itse ensin — poimin "Junebug" (eksplisiittisin
ylistys: "perhaps the best stretch of writing in his entire career") ja "Badlands" (levyn
mikrokosmos, vahvasti kuvailtu). Gemma live-ajolla poimi täsmälleen samat kaksi kappaletta
ilman ohjausta.

**Numerointi ja paginaatio toimi.** `apple_music_list_playlists` haki debug-lokin mukaan
useamman sivun (nähtiin `offset=200`-pyyntö), löysi ei yhtään "New Music #<n>" -nimistä listaa
olemassa olevien 200+ soittolistan joukosta, päätteli n=0 ja loi "New Music #1" oikein. Ei
duplikaattiriskiä (T3:n edellisen debug-kierroksen #2-bugi, ks. yllä, ei toistunut).

**Vahvistettu vakaaksi:** 1/1 puhdas ajo tällä tasolla. Seuraava askel: skaalaa 3 albumin
erään ennen kuin väitetään flow luotettavaksi laajemmin.

### 2026-08-17 — T4: numeroitu-soittolista-flow, 3 albumia

**Testattu:** sama flow yhden albumin sijaan Sputnikin best-new-music-listan 3 ensimmäisellä
albumilla (Marilyn Manson, Sallow Moth, Ripper (CL)) yhdessä agenttiajossa.

**Claude-oraakkeli vs. Gemma:** Manson ja Sallow Moth — kumpikaan arvostelu ei nimeä yhtäkään
kappaletta eksplisiittisenä levyn highlightina (Mansonilla "One Assassination Under God"
-ylistys viittaa Chapter 1:n kappaleeseen, ei tähän Chapter 2 -levyyn), joten oikea poiminta on
0/0 — Gemma päätyi täsmälleen samaan molemmilla. Ripper (CL): arvostelu nimeää "The End of
Universe" -kappaleen suoraan sanalla "highlight track", ja lisäksi kuvailee toista kappaletta
("Into the Coldness of Land of Dead") "one of its most competent and well-written pieces"
-ilmauksella. Oma lukuni olisi poiminut molemmat (2/2); Gemma poimi vain eksplisiittisimmän
("The End of Universe", 1/2) — konservatiivinen mutta perusteltu valinta, ei virhe, sama
rajatapaus-ilmiö kuin aiemmin Marilyn Mansonin kanssa nähty.

**Numerointi jatkui oikein yli ajojen.** `apple_music_list_playlists` löysi edellisen ajon
luoman "New Music #1":n (3 sivun paginaatiolla, 224+ listan joukosta) ja loi oikein
"New Music #2":n — juokseva numerointi toimii peräkkäisillä ajoilla, ei vain tyhjästä.

**Itsekorjautuva haku nähtiin livenä.** `apple_music_search_tracks("Ripper (CL) The End of
Universe")` osui väärään kappaleeseen (LL Cool J); Gemma huomasi tuloksen olevan väärä ilman
ohjausta ja kokeili uudelleen ilman sulkeissa olevaa maatunnusta ("Ripper The End of Universe"),
joka osui oikein. Ei promptimuutosta tarvittu tämän varalle — malli osasi jo.

**Vahvistettu vakaaksi:** 1/1 puhdas ajo 3 albumin tasolla, kappalepoiminta ja numerointi
molemmat oikein. T4 päätetty tähän — flow on riittävän luotettava tuotantokäyttöön nykyisellä
kompleksisuustasolla (1-3 albumia/ajo). Ei havaittu tarvetta statelle tai aliagentti-
pilkkomiselle tällä skaalalla (ks. käyttäjän kanssa käyty pohdinta ennen tätä testikierrosta) —
molemmat testiajot (1 albumi, 3 albumia) olivat yhden agentin sisällä täysin luotettavia.

### 2026-08-17 — tuotantoajo: 10 albumia (ei enää testi, oikea käyttö)

**Ajettu:** käyttäjän pyynnöstä oikea täysimittainen ajo 10 albumilla (isompi hyppy kuin
edellinen 3 albumin taso, käyttäjän oma päätös skaalata suoraan). Yksi puhdas ajo, ei
Claude-oraakkelivertailua tällä kertaa (tuotantokäyttö, ei uusi reliability-kysymys).

**Tulos:** 5/10 albumia tuotti poiminnan (Ripper, mary in the junkyard, Muse, Warning, Olivia
Rodrigo — kukin 1 kappale), 5/10 skippautui perustellusti 0 kappaleella (mm. Thurnin: arvostelu
sanoo suoraan "vaikea poimia yksittäistä kappaletta, levy soi saumattomasti" — malli tunnisti
tämän eikä pakottanut poimintaa). Numerointi jatkui oikein edellisistä ajoista (#1, #2 löytyi
→ loi #3). Sama itsekorjautuva Apple Music -haku nähtiin taas ("Ripper (CL) The End of
Universe" epäonnistui → kokeili "Ripper The End of Universe" ilman ohjausta, osui oikein) —
kolmas kerta sama itsenäinen korjaus, ei enää sattumaa.

**Ei havaittuja ongelmia 10 albumin skaalalla.** Ei kontekstin hukkaa, ei väärää numerointia,
ei duplikaattilistoja. Flow näyttää skaalautuvan lineaarisesti ainakin 1→10 albumiin ilman
statea tai aliagentti-pilkkomista.

### 2026-08-17 — kappalehävikin korjaus + 15 albumin erätesti

**Ongelma joka korjattiin ennen testiä:** `apple_music_search_tracks`-hakuvaiheella ei ollut
mitään ohjeistusta tarkistaa osuiko haku oikeasti oikeaan kappaleeseen, eikä ohjetta mitä tehdä
jos haku epäonnistuu tai osuu väärin (nähty jo aiemmin: "Ripper (CL) The End of Universe" osui
LL Cool J:hin). Malli oli korjannut tämän itse joka kerta, mutta ilman ohjeistusta se oli
tuuria, ei taattua käytöstä — riski että joskus se EI korjaisi ja poimittu kappale jäisi
hiljaa pois soittolistasta, tai pahempaa, väärä kappale päätyisi tilalle.

**Fix (src/agents/gemma.ts, flow-vaihe 3):** promptiin lisätty eksplisiittinen ohje —
tarkista haun palauttaman track-in `name`/`artistName` vastaavuus haettuun ennen käyttöä; jos
ei täsmää, yritä kerran uudelleen yksinkertaistetulla haulla (esim. pudota artistin
sulkeissa oleva maatunnus); jos ei silti löydy, ÄLÄ korvaa toisella kappaleella äläkä jätä
hiljaa pois — merkitse "not found on Apple Music" lopputulokseen käyttäjän tietoon.

**Testi:** 15 albumia neljässä erässä (3+4+4+4), joka erä oma live-ajo Gemmalla, oikea kirjoitus
Apple Musiciin (New Music #4 → #7, jatkoi numerointia oikein #3:n jälkeen). Yhteensä 11/15
albumia tuotti poiminnan (11 albumia × 1-2 kappaletta = 22 poimittua kappaletta), loput 4/15
skipattiin perustellusti (Manson, Sallow Moth, Thurnin, Saidan — kussakin arvostelu ei nimeä
selkeää yksittäistä highlightia, mm. Thurnin: "vaikea erottaa yhtä kappaletta saumattomasta
kokonaisuudesta").

**Tulos: 22/22 poimittua kappaletta löytyi ja tallentui Apple Musiciin, 0 hävikkiä, 0 väärää
korvausta.** Itsekorjautuva haku (LL Cool J -tyyppinen väärähaku → yksinkertaistettu uusi haku)
nähtiin taas Ripperillä, korjautui nyt eksplisiittisen ohjeen mukaisesti ensimmäisellä
yrityksellä. Ei yhtään "not found"-tapausta koko 15 albumin erässä — kaikki haut osuivat
oikein joko suoraan tai yhdellä yksinkertaistetulla uusintahaulla.

**Vahvistettu vakaaksi:** kappalehävikkiä ei havaittu 15 albumin/22 kappaleen otannassa
promptikorjauksen jälkeen. Ei tarvetta statelle tai aliagentti-pilkkomiselle tälläkään
skaalalla — nelierä-ajo (3+4+4+4) toimi täysin luotettavasti yhden agentin sisällä joka
kerta.

**usePersistentState — arvioitu, ei otettu käyttöön.** Harkittiin `usePersistentState`-koukun
käyttöä poimintojen säilyttämiseen tiivistyksen yli, mutta kolmen albumin skaalalla kumpaakaan
oikeaa löydettyä bugia (#1, #2) ei aiheuttanut kontekstin hukka — molemmat olivat tavallisia
koodivirheitä. Päätös: ei lisätä statea ilman todistettua tarvetta ("aloitetaan yksinkertaisesti
ja kasvatetaan kompleksisuutta pikkuhiljaa" -periaate) — otetaan käyttöön vasta kun isomman
skaalan (esim. koko ~24 albumin best-new-music-lista kerralla) testi oikeasti näyttää
kontekstin hukkaavan tietoa, ei ennakoivasti.

### 2026-08-17 — 15 albumia YHDELLÄ ajolla, YHTEEN soittolistaan: aliagentti-arkkitehtuuri

**Uusi tavoite tässä kierroksessa:** aiemmat testit (1, 3, 4x4, 10 albumia) ajoivat aina
useamman ERI Gemma-ajon, useamman ERI soittolistan. Tavoite muuttui: 15 albumia YHDESSÄ
Gemma-ajossa, kaikki YHTEEN soittolistaan — tää olisi ylittänyt 65536 tokenin kontekstin jos
15 täyttä arvostelutekstiä olisi käsitelty yhden agentin sisällä sarjassa (aiempi malli).

**Ratkaisu: `useSubagent` (Flue tukee natiivisti, ks. `npx flue docs read guide/subagents`).**
Uusi `album_picker`-aliagentti (`src/agents/gemma.ts`) käsittelee YHDEN albumin kokonaan
(arvostelu → poiminta → Apple Music -haku → lisäys suoraan soittolistalle) omassa tuoreessa
kontekstissaan — vain sen lyhyt lopputiivistelmä palaa vanhemmalle, ei koskaan täyttä
arvostelutekstiä. Track-ID:t eivät myöskään koskaan kulje tekstinä vanhemman läpi (aliagentti
kutsuu `apple_music_add_tracks` suoraan valmiiksi luotuun playlistId:hen) — ei
transkriptioriskiä pitkien numero-ID:iden kopioinnissa.

**Ensimmäinen yritys epäonnistui skaalassa (13/15 albumia, katkesi kesken).** Debug-loki
paljasti: parent-Gemma dispatchasi vain YHDEN `task`-kutsun sisältäen kaikki 15 albumia yhden
promptin sisällä, sen sijaan että olisi tehnyt 15 erillistä kutsua (kuten 3 albumin testissä
meni oikein — 3 erillistä "tool task" nähtiin). Tuo yksi aliagentti-instanssi prosessoi 15
albumia SARJASSA omassa kontekstissaan ja loppui kesken viimeisen albumin (August Burns Red)
kohdalla, juuri ennen kappaleen hakua/lisäystä — 4 legit-nollaa oikein, mutta 1 albumi jäi
kokonaan käsittelemättä.

**Juurisyy:** "dispatch every album's task together in one batch" -ohje oli epäselvä isommalla
N:llä — 3 albumilla malli tulkitsi sen oikein (3 erillistä kutsua), 15:llä se pakkasi kaikki
yhteen "batch"-kutsuun.

**Fix (ks. `plans/2026-08-17-15-album-single-run-subagent-fan-out.md` täydelle
hypoteesi/ennuste-käsittelylle):** kolme päällekkäistä ohjetta — (1) parent-prompti: "dispatch
a SEPARATE task tool call... ONE call per album... N separate task calls... never combine",
(2) subagent-tooli-kuvaus: sama viesti tool-tasolla, (3) `AlbumPicker`:n oma prompti puolustava
backstop: "process EXACTLY ONE album... if given more than one, process only the first and say
so" — muuttaa epäonnistumisen näkyväksi jos parent silti mokaa dispatchin.

**Vahvistettu: fix toimi täsmälleen ennustetusti.** Uusintaligo näytti 15 erillistä "tool task"
-riviä, kaikki albumit käsiteltiin loppuun asti mukaan lukien August Burns Red. Playlist "New
Music #10": 11/15 albumia tuotti kappaleita (Manson, Sallow Moth, Thurnin, Saidan legit 0 —
samat neljä kuin joka aiemmassa ajossa tällä albumisetillä), 10/11 sai täyden 2/2, Warning 1/1
(arvostelu nimeää vain nimikkokappaleen — oikea, ei bugi). Aliagentti-arkkitehtuuri skaalautuu
15 albumiin yhdessä ajossa ilman kontekstin hukkaa, ilman transkriptiovirheitä, rinnakkaisena.
