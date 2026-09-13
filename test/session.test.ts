import { NodeApiError, NodeOperationError } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import {
	buildServiceLayerBaseUrl,
	ensureSession,
	extractSapErrorCode,
	getSetCookieHeader,
	getTransportErrorDescription,
	parseSetCookieValue,
	sanitizeServiceLayerError,
	sanitizeTransportError,
} from '../nodes/SapBusinessOneServiceLayer/helpers/session';
import { getCredentialFingerprint } from '../nodes/SapBusinessOneServiceLayer/helpers/sessionStore';
import type { ServiceLayerSession } from '../nodes/SapBusinessOneServiceLayer/helpers/types';
import { createTestCredentials } from './helpers/credentials';
import { flattenErrorText } from './helpers/errors';
import { createDeferred, createHttpFake, type FakeResponse, type RouteTable } from './helpers/http';
import { createRequestContext } from './helpers/node';

const LOGIN_OK: FakeResponse = {
	statusCode: 200,
	body: { SessionId: 'sess-1', SessionTimeout: 30 },
	headers: { 'set-cookie': ['B1SESSION=sess-1; Path=/; HttpOnly', 'ROUTEID=.node1; Path=/'] },
};

function login(routes: RouteTable) {
	const http = createHttpFake(routes);
	const { credentials, credentialId } = createTestCredentials();
	const fingerprint = getCredentialFingerprint(credentials);

	return {
		http,
		credentials,
		run: async (): Promise<ServiceLayerSession> =>
			await ensureSession.call(createRequestContext(http), credentialId, fingerprint, credentials),
	};
}

describe('buildServiceLayerBaseUrl', () => {
	it('appends the v2 API path', () => {
		expect(buildServiceLayerBaseUrl('https://sap.invalid:50000')).toBe(
			'https://sap.invalid:50000/b1s/v2',
		);
	});

	it('strips trailing slashes before appending', () => {
		expect(buildServiceLayerBaseUrl('https://sap.invalid:50000///')).toBe(
			'https://sap.invalid:50000/b1s/v2',
		);
	});

	it('trims surrounding whitespace', () => {
		expect(buildServiceLayerBaseUrl('  https://sap.invalid:50000  ')).toBe(
			'https://sap.invalid:50000/b1s/v2',
		);
	});
});

describe('getSetCookieHeader', () => {
	it('reads the lowercase header the transport normally produces', () => {
		expect(getSetCookieHeader({ 'set-cookie': ['a=1'] })).toEqual(['a=1']);
	});

	it('also accepts the canonical casing', () => {
		expect(getSetCookieHeader({ 'Set-Cookie': ['a=1'] })).toEqual(['a=1']);
	});

	it('returns undefined when the header is absent', () => {
		expect(getSetCookieHeader({})).toBeUndefined();
	});
});

describe('parseSetCookieValue', () => {
	it('reads a named cookie out of an array', () => {
		expect(parseSetCookieValue(['ROUTEID=.node1; Path=/', 'B1SESSION=abc'], 'B1SESSION')).toBe(
			'abc',
		);
	});

	it('reads a named cookie out of a single string', () => {
		expect(parseSetCookieValue('B1SESSION=abc; Path=/; HttpOnly', 'B1SESSION')).toBe('abc');
	});

	it('returns undefined when the cookie is absent', () => {
		expect(parseSetCookieValue(['ROUTEID=.node1'], 'B1SESSION')).toBeUndefined();
	});

	it('returns undefined for an empty value', () => {
		expect(parseSetCookieValue(['B1SESSION=; Path=/'], 'B1SESSION')).toBeUndefined();
	});

	it('matches the whole cookie name, not a suffix of another', () => {
		expect(parseSetCookieValue(['XB1SESSION=abc'], 'B1SESSION')).toBeUndefined();
	});

	it('ignores non-string entries', () => {
		expect(parseSetCookieValue([undefined, 42, 'B1SESSION=abc'], 'B1SESSION')).toBe('abc');
	});
});

describe('extractSapErrorCode', () => {
	it.each([
		['a numeric code', { error: { code: 301 } }, 301],
		['a numeric string code', { error: { code: '301' } }, 301],
		['a non-numeric code', { error: { code: 'abc' } }, undefined],
		['no error member', {}, undefined],
		['a null body', null, undefined],
		['an undefined body', undefined, undefined],
	])('handles %s', (_label, body, expected) => {
		expect(extractSapErrorCode(body)).toBe(expected);
	});
});

describe('sanitizeServiceLayerError', () => {
	it('emits only the status, message and SAP code', () => {
		const sanitized = sanitizeServiceLayerError(401, {
			error: { code: 301, message: { value: 'Invalid session.' } },
			internalDetails: { cookie: 'B1SESSION=sess-1' },
		});

		// Exact shape on purpose: this fails the day anything else is passed through.
		expect(sanitized).toEqual({
			statusCode: 401,
			message: 'Invalid session.',
			sapErrorCode: 301,
		});
	});

	it('keeps the SAP code out of every key NodeApiError reads as an HTTP status', () => {
		const sanitized = sanitizeServiceLayerError(401, { error: { code: 301 } });

		expect(sanitized).not.toHaveProperty('code');
		expect(sanitized.statusCode).toBe(401);
	});

	it('accepts a flat string message', () => {
		expect(sanitizeServiceLayerError(500, { error: { message: 'Boom' } })).toEqual({
			statusCode: 500,
			message: 'Boom',
		});
	});

	it('omits the message entirely when the body carries none', () => {
		expect(sanitizeServiceLayerError(500, {})).toEqual({ statusCode: 500 });
	});
});

describe('sanitizeTransportError', () => {
	it('passes a short transport code through and drops everything else', () => {
		const sanitized = sanitizeTransportError(
			{
				code: 'ECONNREFUSED',
				message: 'connect ECONNREFUSED 10.0.0.5:50000',
				config: { headers: { Cookie: 'B1SESSION=sess-1' }, data: { Password: 'pw-abc' } },
			},
			'signing in',
		);

		expect(sanitized).toEqual({
			message:
				'Could not reach the SAP Business One Service Layer while signing in (ECONNREFUSED)',
			transportErrorCode: 'ECONNREFUSED',
		});

		const text = flattenErrorText(sanitized);
		expect(text).not.toContain('B1SESSION');
		expect(text).not.toContain('pw-abc');
		expect(text).not.toContain('10.0.0.5');
	});

	it('drops a code that carries more than a code', () => {
		const sanitized = sanitizeTransportError(
			{ code: 'connect ECONNREFUSED 10.0.0.5:50000' },
			'signing in',
		);

		expect(sanitized).not.toHaveProperty('transportErrorCode');
		expect(flattenErrorText(sanitized)).not.toContain('10.0.0.5');
	});

	it.each([
		['a non-string code', { code: 12345 }],
		['an over-long code', { code: 'A'.repeat(65) }],
		['no code at all', {}],
	])('omits the transport code for %s', (_label, error) => {
		expect(sanitizeTransportError(error, 'signing in')).toEqual({
			message: 'Could not reach the SAP Business One Service Layer while signing in',
		});
	});
});

describe('getTransportErrorDescription', () => {
	const { credentials } = createTestCredentials();

	it.each([
		'CERT_HAS_EXPIRED',
		'DEPTH_ZERO_SELF_SIGNED_CERT',
		'ERR_TLS_CERT_ALTNAME_INVALID',
		'ERR_SSL_WRONG_VERSION_NUMBER',
	])(
		'points at the credential toggle for %s',
		(code) => {
			expect(getTransportErrorDescription({ code }, credentials)).toContain(
				'Allow Unauthorized Certificates',
			);
		},
	);

	it('stays quiet when the credential already allows untrusted certificates', () => {
		expect(
			getTransportErrorDescription(
				{ code: 'CERT_HAS_EXPIRED' },
				{ ...credentials, ignoreSslIssues: true },
			),
		).toBeUndefined();
	});

	// The hint is keyed off CERT/SSL/TLS appearing in the code, so OpenSSL codes
	// that name neither (UNABLE_TO_VERIFY_LEAF_SIGNATURE is the common one) do not
	// get it. Pinned as current behaviour, not endorsed as correct.
	it('misses a TLS code that names neither CERT, SSL nor TLS', () => {
		expect(
			getTransportErrorDescription({ code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' }, credentials),
		).toBeUndefined();
	});

	it('stays quiet for an unrelated transport failure', () => {
		expect(getTransportErrorDescription({ code: 'ECONNREFUSED' }, credentials)).toBeUndefined();
	});
});

describe('ensureSession', () => {
	it('logs in and returns the session the server reported', async () => {
		const scenario = login({ 'POST /Login': LOGIN_OK });

		const session = await scenario.run();

		expect(session.sessionId).toBe('sess-1');
		expect(session.routeId).toBe('.node1');
		expect(session.timeoutMs).toBe(1_800_000);
		expect(scenario.http.countFor('POST /Login')).toBe(1);
	});

	it('builds the login request from the credential', async () => {
		const scenario = login({ 'POST /Login': LOGIN_OK });

		await scenario.run();

		const [request] = scenario.http.callsFor('POST /Login');
		expect(request).toMatchObject({
			baseURL: `${scenario.credentials.baseUrl}/b1s/v2`,
			url: '/Login',
			method: 'POST',
			json: true,
			returnFullResponse: true,
			ignoreHttpStatusErrors: true,
			skipSslCertificateValidation: false,
			body: {
				CompanyDB: scenario.credentials.companyDb,
				UserName: scenario.credentials.username,
				Password: scenario.credentials.password,
			},
		});
	});

	it('mirrors the credential TLS setting onto the request', async () => {
		const http = createHttpFake({ 'POST /Login': LOGIN_OK });
		const { credentials, credentialId } = createTestCredentials({ ignoreSslIssues: true });

		await ensureSession.call(
			createRequestContext(http),
			credentialId,
			getCredentialFingerprint(credentials),
			credentials,
		);

		expect(http.callsFor('POST /Login')[0].skipSslCertificateValidation).toBe(true);
	});

	it('falls back to the B1SESSION cookie when the body carries no SessionId', async () => {
		const scenario = login({
			'POST /Login': {
				statusCode: 200,
				body: { SessionTimeout: 30 },
				headers: { 'set-cookie': ['B1SESSION=from-cookie; Path=/'] },
			},
		});

		expect((await scenario.run()).sessionId).toBe('from-cookie');
	});

	it('leaves routeId unset when the server sends no ROUTEID', async () => {
		const scenario = login({
			'POST /Login': { statusCode: 200, body: { SessionId: 'sess-1' } },
		});

		expect((await scenario.run()).routeId).toBeUndefined();
	});

	it.each([
		['a number of minutes', 30, 1_800_000],
		['a numeric string', '30', 1_800_000],
		['zero', 0, undefined],
		['a negative value', -1, undefined],
		['a non-numeric value', 'abc', undefined],
		['an absent value', undefined, undefined],
	])('reads SessionTimeout given as %s', async (_label, SessionTimeout, expected) => {
		const scenario = login({
			'POST /Login': { statusCode: 200, body: { SessionId: 'sess-1', SessionTimeout } },
		});

		expect((await scenario.run()).timeoutMs).toBe(expected);
	});

	it('reuses a cached session instead of opening a second licensed one', async () => {
		const scenario = login({ 'POST /Login': LOGIN_OK });

		const first = await scenario.run();
		const second = await scenario.run();

		expect(second).toBe(first);
		expect(scenario.http.countFor('POST /Login')).toBe(1);
	});

	it('collapses concurrent logins for one credential onto a single /Login', async () => {
		const deferred = createDeferred<FakeResponse>();
		const scenario = login({ 'POST /Login': async () => await deferred.promise });

		const flights = [1, 2, 3, 4, 5].map(async () => await scenario.run());

		// Checked while /Login is still open. Once it settles the session cache
		// would absorb the duplicates and a passing count would prove nothing.
		expect(scenario.http.countFor('POST /Login')).toBe(1);

		deferred.resolve(LOGIN_OK);
		const sessions = await Promise.all(flights);

		expect(scenario.http.countFor('POST /Login')).toBe(1);
		expect(sessions.every((entry) => entry === sessions[0])).toBe(true);

		// The sixth call is served by the cache, not by the in-flight map.
		await scenario.run();
		expect(scenario.http.countFor('POST /Login')).toBe(1);
	});

	it('does not collapse logins for different credentials', async () => {
		const deferred = createDeferred<FakeResponse>();
		const http = createHttpFake({ 'POST /Login': async () => await deferred.promise });
		const context = createRequestContext(http);

		const flights = [createTestCredentials(), createTestCredentials()].map(
			async ({ credentials, credentialId }) =>
				await ensureSession.call(
					context,
					credentialId,
					getCredentialFingerprint(credentials),
					credentials,
				),
		);

		expect(http.countFor('POST /Login')).toBe(2);

		deferred.resolve(LOGIN_OK);
		await Promise.all(flights);
	});

	it('does not cache a failed login', async () => {
		const scenario = login({
			'POST /Login': [{ statusCode: 401, body: { error: { message: 'Bad login.' } } }, LOGIN_OK],
		});

		await expect(scenario.run()).rejects.toBeInstanceOf(NodeApiError);

		expect((await scenario.run()).sessionId).toBe('sess-1');
		expect(scenario.http.countFor('POST /Login')).toBe(2);
	});

	it('reports an authentication failure without leaking the password', async () => {
		const scenario = login({
			'POST /Login': { statusCode: 401, body: { error: { code: -304, message: 'Bad login.' } } },
		});

		const error = await scenario.run().catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(NodeApiError);

		const text = flattenErrorText(error);
		expect(text).toContain('authentication failed');
		expect(text).not.toContain(scenario.credentials.password);
	});

	it('fails clearly when the server returns neither a SessionId nor a cookie', async () => {
		const scenario = login({ 'POST /Login': { statusCode: 200, body: {} } });

		const error = await scenario.run().catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(NodeOperationError);
		expect(flattenErrorText(error)).toContain('did not return a session');
	});

	it('sanitises a transport failure during login', async () => {
		const scenario = login({
			'POST /Login': {
				rejectWith: {
					code: 'ECONNREFUSED',
					config: { data: { Password: 'pw-abc' }, headers: { Cookie: 'B1SESSION=x' } },
				},
			},
		});

		const error = await scenario.run().catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(NodeApiError);

		const text = flattenErrorText(error);
		expect(text).toContain('Could not connect');
		expect(text).not.toContain('pw-abc');
		expect(text).not.toContain('B1SESSION');
	});
});
