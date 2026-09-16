import { createHash } from 'node:crypto';

import { withSingleFlight } from './singleFlight';
import type { ServiceLayerCredentials, ServiceLayerSession, SessionCacheEntry } from './types';

/**
 * Sessions are cached per n8n process. In queue mode every worker keeps its own
 * cache, so one credential can hold up to one licensed Service Layer session
 * per worker. Sessions are intentionally not persisted across restarts.
 */
const sessions = new Map<string, SessionCacheEntry>();

/** In-flight logins, so concurrent requests share a single `/Login` call. */
const pendingLogins = new Map<string, Promise<ServiceLayerSession>>();

/**
 * Upper bound for the guard band subtracted from the server-provided idle
 * timeout. The band itself is derived from that timeout, so no Service Layer
 * session lifetime is hardcoded here.
 */
const MAX_EXPIRY_SKEW_MS = 60_000;
const EXPIRY_SKEW_RATIO = 0.1;

/**
 * Hashes the credential values a session depends on. Hashing keeps the password
 * out of memory as a cache key or cache entry field.
 */
export function getCredentialFingerprint(credentials: ServiceLayerCredentials): string {
	return createHash('sha256')
		.update(
			JSON.stringify([
				credentials.baseUrl,
				credentials.companyDb,
				credentials.username,
				credentials.password,
				credentials.skipTlsVerification,
			]),
		)
		.digest('hex');
}

/**
 * Prefers the stable n8n credential ID so an edited credential replaces its
 * cached session. Falls back to the fingerprint when no ID is available, which
 * only happens for credentials that were never saved through the n8n UI.
 */
export function getSessionCacheKey(
	credentialId: string | null | undefined,
	fingerprint: string,
): string {
	return credentialId ?? `fingerprint:${fingerprint}`;
}

function getExpirySkewMs(timeoutMs: number): number {
	return Math.min(MAX_EXPIRY_SKEW_MS, timeoutMs * EXPIRY_SKEW_RATIO);
}

/**
 * `SessionTimeout` is an idle timeout, so expiry is measured from the last
 * successful use rather than from login.
 */
function isSessionExpired(session: ServiceLayerSession, now: number): boolean {
	if (session.timeoutMs === undefined) {
		return false;
	}

	return now >= session.lastUsedAt + session.timeoutMs - getExpirySkewMs(session.timeoutMs);
}

/**
 * Returns the cached session, or `undefined` after removing the entry when the
 * credential values changed or the session went idle for too long.
 */
export function getSession(
	key: string,
	fingerprint: string,
	now: number,
): ServiceLayerSession | undefined {
	const entry = sessions.get(key);

	if (entry === undefined) {
		return undefined;
	}

	if (entry.fingerprint !== fingerprint || isSessionExpired(entry.session, now)) {
		sessions.delete(key);
		return undefined;
	}

	return entry.session;
}

export function storeSession(key: string, fingerprint: string, session: ServiceLayerSession): void {
	sessions.set(key, { fingerprint, session });
}

export function touchSession(session: ServiceLayerSession, now: number): void {
	session.lastUsedAt = now;
}

/**
 * Compare-and-delete: when a session is given, the entry is only removed while
 * it still holds that exact session, so a concurrent re-login's fresh session
 * is never discarded.
 */
export function invalidateSession(key: string, session?: ServiceLayerSession): void {
	const entry = sessions.get(key);

	if (entry === undefined) {
		return;
	}

	if (session !== undefined && entry.session !== session) {
		return;
	}

	sessions.delete(key);
}

/**
 * Collapses concurrent logins for the same credential onto one `/Login` call,
 * so a batch of items does not open one licensed session per item.
 */
export async function withSingleFlightLogin(
	key: string,
	fingerprint: string,
	login: () => Promise<ServiceLayerSession>,
): Promise<ServiceLayerSession> {
	return await withSingleFlight(pendingLogins, `${key}|${fingerprint}`, login);
}
