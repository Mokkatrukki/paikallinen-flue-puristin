// Raw Apple Music API client: developer-token JWT signing, library-user-token
// storage, and a rate-limited fetch wrapper. No playlist/track business logic
// lives here — that belongs in src/tools/apple-music.ts.

import { createSign } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const BASE_URL = 'https://api.music.apple.com/v1';
const RATE_MS = 150;

function env(name: string): string {
	const value = process.env[name];
	if (!value) {
		throw new Error(
			`Apple Music: ympäristömuuttuja ${name} puuttuu. Katso .env.example.`,
		);
	}
	return value;
}

function teamId(): string {
	return env('APPLE_TEAM_ID');
}

function keyId(): string {
	return env('APPLE_KEY_ID');
}

function privateKey(): string {
	if (process.env.APPLE_PRIVATE_KEY) return process.env.APPLE_PRIVATE_KEY;
	const file = env('APPLE_PRIVATE_KEY_FILE');
	return readFileSync(file, 'utf-8').trim();
}

function tokenFilePath(): string {
	return process.env.APPLE_MUSIC_TOKEN_FILE ?? 'data/apple-music-token.json';
}

// ─── Developer token (JWT, ES256) ──────────────────────────────────────────

let cachedDeveloperToken: { token: string; expiresAt: number } | null = null;

/**
 * Signs a fresh developer-token JWT from the .p8 key, or returns the cached
 * one while it still has more than a day of life left.
 */
export function developerToken(): string {
	const now = Math.floor(Date.now() / 1000);
	if (cachedDeveloperToken && cachedDeveloperToken.expiresAt - now > 86_400) {
		return cachedDeveloperToken.token;
	}

	const exp = now + 15_777_000; // ~6 months, Apple's documented maximum
	const header = base64url(JSON.stringify({ alg: 'ES256', kid: keyId() }));
	const payload = base64url(JSON.stringify({ iss: teamId(), iat: now, exp }));
	const signingInput = `${header}.${payload}`;

	const signer = createSign('SHA256');
	signer.update(signingInput);
	signer.end();
	// Apple requires the raw IEEE-P1363 (R||S) signature, not the default DER encoding.
	const signature = signer
		.sign({ key: privateKey(), dsaEncoding: 'ieee-p1363' })
		.toString('base64url');

	const token = `${signingInput}.${signature}`;
	cachedDeveloperToken = { token, expiresAt: exp };
	return token;
}

function base64url(json: string): string {
	return Buffer.from(json).toString('base64url');
}

// ─── Music user token (per-listener, from the MusicKit JS login flow) ──────

export interface AppleMusicUserToken {
	musicUserToken: string;
	storefront: string;
	savedAt: number;
}

export function loadUserToken(): AppleMusicUserToken | null {
	try {
		return JSON.parse(readFileSync(tokenFilePath(), 'utf-8')) as AppleMusicUserToken;
	} catch {
		return null;
	}
}

export function saveUserToken(token: AppleMusicUserToken): void {
	const path = tokenFilePath();
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify(token, null, '\t'));
}

/** Fetches the listener's storefront and persists the user token to disk. */
export async function authorizeUser(musicUserToken: string): Promise<AppleMusicUserToken> {
	let storefront = 'us';
	try {
		const res = await fetch(`${BASE_URL}/me/storefront`, {
			headers: {
				Authorization: `Bearer ${developerToken()}`,
				'Music-User-Token': musicUserToken,
			},
		});
		if (res.ok) {
			const data = (await res.json()) as { data?: Array<{ id?: string }> };
			storefront = data.data?.[0]?.id ?? storefront;
		}
	} catch {
		// keep the fallback storefront
	}
	const stored: AppleMusicUserToken = { musicUserToken, storefront, savedAt: Date.now() };
	saveUserToken(stored);
	return stored;
}

export function authStatus(): { hasDeveloperToken: boolean; hasUserToken: boolean; storefront: string | null } {
	let hasDeveloperToken = false;
	try {
		developerToken();
		hasDeveloperToken = true;
	} catch {
		// env not configured
	}
	const stored = loadUserToken();
	return {
		hasDeveloperToken,
		hasUserToken: stored != null,
		storefront: stored?.storefront ?? null,
	};
}

export function storefront(): string {
	return process.env.APPLE_MUSIC_STOREFRONT ?? loadUserToken()?.storefront ?? 'us';
}

// ─── Base request ───────────────────────────────────────────────────────────

let lastCallAt = 0;

export interface AmRequestOptions {
	method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
	body?: unknown;
	params?: Record<string, string | number>;
	requireUserToken?: boolean;
}

export class AppleMusicError extends Error {
	constructor(public status: number, message: string) {
		super(message);
		this.name = 'AppleMusicError';
	}
}

/** Low-level request against the Apple Music catalog/library API. */
export async function apiRequest(
	path: string,
	opts: AmRequestOptions = {},
	_retried = false,
): Promise<any> {
	const wait = RATE_MS - (Date.now() - lastCallAt);
	if (wait > 0) await new Promise((r) => setTimeout(r, wait));
	lastCallAt = Date.now();

	const url = new URL(path.startsWith('http') ? path : `${BASE_URL}${path}`);
	if (opts.params) {
		for (const [k, v] of Object.entries(opts.params)) url.searchParams.set(k, String(v));
	}

	const headers: Record<string, string> = {
		Authorization: `Bearer ${developerToken()}`,
		'Content-Type': 'application/json',
	};

	const userToken = loadUserToken();
	if (opts.requireUserToken) {
		if (!userToken) {
			throw new AppleMusicError(
				401,
				'Ei Music User Tokenia — käyttäjä ei ole vielä valtuuttanut Apple Musicia. Katso README: apple-music-auth.',
			);
		}
		headers['Music-User-Token'] = userToken.musicUserToken;
	} else if (userToken) {
		headers['Music-User-Token'] = userToken.musicUserToken;
	}

	const res = await fetch(url, {
		method: opts.method ?? 'GET',
		headers,
		body: opts.body != null ? JSON.stringify(opts.body) : undefined,
	});

	if (res.status === 204) return null;

	if (res.status === 429 && !_retried) {
		const retryAfterMs = Number(res.headers.get('Retry-After') ?? '3') * 1000;
		await new Promise((r) => setTimeout(r, retryAfterMs));
		return apiRequest(path, opts, true);
	}

	// A fresh developer token can transiently 401 right after signing (clock
	// skew between us and Apple's edge); one retry clears it. A 401 caused by
	// an unsupported method (PATCH/PUT/DELETE on playlists — see
	// src/tools/apple-music.ts) just fails the same way twice, which is fine.
	if (res.status === 401 && !_retried) {
		await new Promise((r) => setTimeout(r, 600));
		return apiRequest(path, opts, true);
	}

	if (!res.ok) {
		const body = await res.text();
		throw new AppleMusicError(res.status, `Apple Music API ${res.status}: ${body.slice(0, 300)}`);
	}

	return res.json();
}
