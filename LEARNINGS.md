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
