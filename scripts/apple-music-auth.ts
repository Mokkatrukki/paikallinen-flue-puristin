// One-off dev script: opens a local MusicKit JS login page so the operator
// can authorize this app against their Apple Music account. Run with:
//
//   bun scripts/apple-music-auth.ts
//
// Not part of the Flue runtime — dev tooling only, hence the Bun.serve use.
import { authorizeUser, developerToken } from '../src/lib/apple-music.ts';

const PORT = Number(process.env.APPLE_MUSIC_AUTH_PORT ?? 8123);

const devToken = developerToken(); // throws early if .env is misconfigured

const html = `<!DOCTYPE html>
<html lang="fi">
<head>
  <meta charset="UTF-8">
  <title>Apple Music -valtuutus</title>
  <script src="https://js-cdn.music.apple.com/musickit/v3/musickit.js" crossorigin></script>
  <style>
    body { font-family: -apple-system, sans-serif; max-width: 480px; margin: 100px auto; text-align: center; }
    button { background: #fc3c44; color: white; border: none; padding: 12px 24px; font-size: 16px; border-radius: 8px; cursor: pointer; }
    button:disabled { opacity: .5; cursor: default; }
    #status { margin-top: 20px; color: #666; white-space: pre-wrap; font-size: 13px; }
  </style>
</head>
<body>
  <h1>Apple Music</h1>
  <p>Valtuuta paikallinen-flue-puristin lukemaan ja muokkaamaan kirjastoasi.</p>
  <button id="btn" disabled>Ladataan MusicKit...</button>
  <div id="status"></div>
  <script>
    const status = document.getElementById('status');
    const btn = document.getElementById('btn');
    async function init() {
      const music = await MusicKit.configure({
        developerToken: ${JSON.stringify(devToken)},
        app: { name: 'paikallinen-flue-puristin', build: '1.0' },
      });
      btn.textContent = 'Kirjaudu Apple Music -tilille';
      btn.disabled = false;
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        status.textContent = 'Kirjaudutaan...';
        try {
          await music.authorize();
          const token = music.musicUserToken;
          if (!token) throw new Error('musicUserToken jäi tyhjäksi');
          const r = await fetch('/callback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token }),
          });
          status.textContent = r.ok
            ? 'Valtuutettu! Voit sulkea tämän välilehden.'
            : 'Callback epäonnistui: ' + r.status;
        } catch (e) {
          status.textContent = 'Virhe: ' + (e instanceof Error ? e.message : String(e));
          btn.disabled = false;
        }
      });
    }
    if (window.MusicKit) init();
    else document.addEventListener('musickitloaded', init);
  </script>
</body>
</html>`;

const server = Bun.serve({
	port: PORT,
	async fetch(req) {
		const url = new URL(req.url);
		if (req.method === 'GET' && url.pathname === '/') {
			return new Response(html, { headers: { 'Content-Type': 'text/html' } });
		}
		if (req.method === 'POST' && url.pathname === '/callback') {
			const { token } = (await req.json()) as { token: string };
			const saved = await authorizeUser(token);
			console.log(`\nValtuutettu. Storefront: ${saved.storefront}`);
			console.log('Sulje selain ja paina Ctrl+C.');
			return Response.json({ ok: true });
		}
		return new Response('Not found', { status: 404 });
	},
});

console.log(`\nAvaa selaimessa: http://127.0.0.1:${server.port}`);
console.log('Odotetaan valtuutusta... (Ctrl+C keskeyttää)\n');
await new Promise(() => {});
