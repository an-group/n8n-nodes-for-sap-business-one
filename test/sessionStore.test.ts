import { describe, expect, it, vi } from 'vitest';

import {
	getCredentialFingerprint,
	getSession,
	getSessionCacheKey,
	invalidateSession,
	storeSession,
	touchSession,
	withSingleFlightLogin,
} from '../nodes/SapBusinessOneServiceLayer/helpers/sessionStore';
import type { ServiceLayerSession } from '../nodes/SapBusinessOneServiceLayer/helpers/types';
import { createTestCredentials } from './helpers/credentials';
import { createDeferred } from './helpers/http';

const NOW = 1_000_000;

function session(overrides: Partial<ServiceLayerSession> = {}): ServiceLayerSession {
	return { sessionId: 'sess-1', lastUsedAt: NOW, ...overrides };
}

describe('getCredentialFingerprint', () => {
	it('is stable for the same credential values', () => {
		const { credentials } = createTestCredentials();

		expect(getCredentialFingerprint(credentials)).toBe(getCredentialFingerprint(credentials));
	});

	it('is a sha256 hex digest', () => {
		const { credentials } = createTestCredentials();

		expect(getCredentialFingerprint(credentials)).toMatch(/^[0-9a-f]{64}$/);
	});

	it('never embeds the password', () => {
		const { credentials } = createTestCredentials();

		expect(getCredentialFingerprint(credentials)).not.toContain(credentials.password);
	});

	it.each([
		['baseUrl', { baseUrl: 'https://other.invalid:50000' }],
		['companyDb', { companyDb: 'OTHERDB' }],
		['username', { username: 'other' }],
		['password', { password: 'other' }],
		['ignoreSslIssues', { ignoreSslIssues: true }],
	])('changes when %s changes', (_field, override) => {
		const { credentials } = createTestCredentials();
		const changed = { ...credentials, ...override };

		expect(getCredentialFingerprint(changed)).not.toBe(getCredentialFingerprint(credentials));
	});
});

describe('getSessionCacheKey', () => {
	// The isolation strategy for the whole suite rests on the credential ID
	// deciding the cache key. If this stops holding, tests start sharing entries.
	it('prefers the n8n credential ID', () => {
		expect(getSessionCacheKey('cred-1', 'fp-a')).toBe('cred-1');
	});

	it.each([
		['null', null],
		['undefined', undefined],
	])('falls back to the fingerprint for %s', (_label, credentialId) => {
		expect(getSessionCacheKey(credentialId, 'fp-a')).toBe('fingerprint:fp-a');
	});
});

describe('getSession', () => {
	it('returns a stored session by reference', () => {
		const stored = session();
		storeSession('k-roundtrip', 'fp', stored);

		expect(getSession('k-roundtrip', 'fp', NOW)).toBe(stored);
	});

	it('returns undefined for an unknown key', () => {
		expect(getSession('k-unknown', 'fp', NOW)).toBeUndefined();
	});

	it('drops the entry when the fingerprint no longer matches', () => {
		storeSession('k-fingerprint', 'fp-old', session());

		expect(getSession('k-fingerprint', 'fp-new', NOW)).toBeUndefined();
		// Deleted, not merely rejected: the original fingerprint no longer resolves.
		expect(getSession('k-fingerprint', 'fp-old', NOW)).toBeUndefined();
	});

	it('never expires a session whose timeout the server did not report', () => {
		storeSession('k-no-timeout', 'fp', session({ timeoutMs: undefined }));

		expect(getSession('k-no-timeout', 'fp', Number.MAX_SAFE_INTEGER)).toBeDefined();
	});

	it('caps the expiry guard band at 60 seconds', () => {
		// 30 min idle timeout: skew is min(60_000, 180_000) = 60_000.
		storeSession('k-capped', 'fp', session({ timeoutMs: 1_800_000 }));

		expect(getSession('k-capped', 'fp', NOW + 1_739_999)).toBeDefined();
		expect(getSession('k-capped', 'fp', NOW + 1_740_000)).toBeUndefined();
	});

	it('derives the guard band from the timeout when that is below the cap', () => {
		// 100s idle timeout: skew is min(60_000, 10_000) = 10_000.
		storeSession('k-ratio', 'fp', session({ timeoutMs: 100_000 }));

		expect(getSession('k-ratio', 'fp', NOW + 89_999)).toBeDefined();
		expect(getSession('k-ratio', 'fp', NOW + 90_000)).toBeUndefined();
	});
});

describe('touchSession', () => {
	it('measures expiry from the last use, not from login', () => {
		const stored = session({ timeoutMs: 100_000 });
		storeSession('k-touch', 'fp', stored);

		touchSession(stored, NOW + 50_000);

		// Would have expired at NOW + 90_000 without the touch.
		expect(getSession('k-touch', 'fp', NOW + 130_000)).toBe(stored);
		expect(getSession('k-touch', 'fp', NOW + 140_000)).toBeUndefined();
	});
});

describe('invalidateSession', () => {
	it('removes the entry when no session is given', () => {
		storeSession('k-invalidate', 'fp', session());

		invalidateSession('k-invalidate');

		expect(getSession('k-invalidate', 'fp', NOW)).toBeUndefined();
	});

	it('removes the entry when the given session is the stored one', () => {
		const stored = session();
		storeSession('k-invalidate-match', 'fp', stored);

		invalidateSession('k-invalidate-match', stored);

		expect(getSession('k-invalidate-match', 'fp', NOW)).toBeUndefined();
	});

	it('keeps a replacement session that a concurrent re-login already stored', () => {
		const superseded = session({ sessionId: 'sess-old' });
		const replacement = session({ sessionId: 'sess-new' });
		storeSession('k-compare', 'fp', replacement);

		invalidateSession('k-compare', superseded);

		expect(getSession('k-compare', 'fp', NOW)).toBe(replacement);
	});

	it('does nothing for an unknown key', () => {
		expect(() => invalidateSession('k-absent')).not.toThrow();
	});
});

describe('withSingleFlightLogin', () => {
	it('collapses concurrent logins for one credential', async () => {
		const deferred = createDeferred<ServiceLayerSession>();
		const login = vi.fn(async () => await deferred.promise);

		const flights = [1, 2, 3].map(async () =>
			await withSingleFlightLogin('k-flight', 'fp', login),
		);

		expect(login).toHaveBeenCalledTimes(1);

		deferred.resolve(session());
		await Promise.all(flights);
	});

	it('does not collapse logins whose credential values differ', async () => {
		const deferred = createDeferred<ServiceLayerSession>();
		const login = vi.fn(async () => await deferred.promise);

		const flights = [
			withSingleFlightLogin('k-shared', 'fp-a', login),
			withSingleFlightLogin('k-shared', 'fp-b', login),
		];

		expect(login).toHaveBeenCalledTimes(2);

		deferred.resolve(session());
		await Promise.all(flights);
	});
});
