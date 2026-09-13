import { NodeApiError } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import {
	fetchEntityCollection,
	serviceLayerApiRequest,
	type ServiceLayerRequestOptions,
} from '../nodes/SapBusinessOneServiceLayer/helpers/request';
import { createTestCredentials } from './helpers/credentials';
import { flattenErrorText } from './helpers/errors';
import { createHttpFake, type FakeResponse, type RouteTable } from './helpers/http';
import { createRequestContext } from './helpers/node';

const LOGIN_OK: FakeResponse = {
	statusCode: 200,
	body: { SessionId: 'sess-1', SessionTimeout: 30 },
	headers: { 'set-cookie': ['B1SESSION=sess-1; Path=/'] },
};

const LOGIN_SECOND: FakeResponse = {
	statusCode: 200,
	body: { SessionId: 'sess-2', SessionTimeout: 30 },
	headers: { 'set-cookie': ['B1SESSION=sess-2; Path=/'] },
};

const SESSION_EXPIRED: FakeResponse = {
	statusCode: 401,
	body: { error: { code: 301, message: { value: 'Invalid session.' } } },
};

function scenario(routes: RouteTable, overrides: Parameters<typeof createTestCredentials>[0] = {}) {
	const http = createHttpFake(routes);
	const { credentials, credentialId } = createTestCredentials(overrides);
	const context = createRequestContext(http);

	return {
		http,
		credentials,
		credentialId,
		send: async (options: ServiceLayerRequestOptions) =>
			await serviceLayerApiRequest.call(context, credentials, credentialId, options),
		collect: async (entitySetName: string, limit: number | undefined) =>
			await fetchEntityCollection.call(context, credentials, credentialId, entitySetName, limit),
	};
}

describe('serviceLayerApiRequest', () => {
	it('authenticates the request with the session cookie', async () => {
		const test = scenario({
			'POST /Login': LOGIN_OK,
			'GET /Orders': { statusCode: 200, body: { value: [] } },
		});

		await test.send({ url: '/Orders', method: 'GET' });

		expect(test.http.callsFor('GET /Orders')[0].headers?.Cookie).toBe('B1SESSION=sess-1');
	});

	it('appends ROUTEID to the cookie when the server issued one', async () => {
		const test = scenario({
			'POST /Login': {
				statusCode: 200,
				body: { SessionId: 'sess-1' },
				headers: { 'set-cookie': ['B1SESSION=sess-1', 'ROUTEID=.node1'] },
			},
			'GET /Orders': { statusCode: 200, body: {} },
		});

		await test.send({ url: '/Orders', method: 'GET' });

		expect(test.http.callsFor('GET /Orders')[0].headers?.Cookie).toBe(
			'B1SESSION=sess-1; ROUTEID=.node1',
		);
	});

	it('strips caller-supplied cookie headers in any casing', async () => {
		const test = scenario({
			'POST /Login': LOGIN_OK,
			'GET /Orders': { statusCode: 200, body: {} },
		});

		await test.send({
			url: '/Orders',
			method: 'GET',
			headers: { cookie: 'evil=1', Cookie: 'evil=2', COOKIE: 'evil=3', Prefer: 'keep-me' },
		});

		const { headers } = test.http.callsFor('GET /Orders')[0];

		expect(headers?.Cookie).toBe('B1SESSION=sess-1');
		expect(headers?.Prefer).toBe('keep-me');
		expect(JSON.stringify(headers)).not.toContain('evil');
	});

	it('owns the transport options the caller cannot set', async () => {
		const test = scenario(
			{ 'POST /Login': LOGIN_OK, 'GET /Orders': { statusCode: 200, body: {} } },
			{ ignoreSslIssues: true },
		);

		await test.send({ url: '/Orders', method: 'GET' });

		expect(test.http.callsFor('GET /Orders')[0]).toMatchObject({
			baseURL: `${test.credentials.baseUrl}/b1s/v2`,
			skipSslCertificateValidation: true,
			returnFullResponse: true,
			ignoreHttpStatusErrors: true,
		});
	});

	it('returns only the body and status, never the response headers', async () => {
		const test = scenario({
			'POST /Login': LOGIN_OK,
			'GET /Orders(45)': {
				statusCode: 200,
				body: { DocEntry: 45 },
				headers: { 'set-cookie': ['B1SESSION=sess-1'] },
			},
		});

		const result = await test.send({ url: '/Orders(45)', method: 'GET' });

		expect(JSON.stringify(result)).toBe(
			JSON.stringify({ body: { DocEntry: 45 }, statusCode: 200 }),
		);
	});

	it('reuses the session across sequential requests', async () => {
		const test = scenario({
			'POST /Login': LOGIN_OK,
			'GET /Orders': { statusCode: 200, body: {} },
		});

		await test.send({ url: '/Orders', method: 'GET' });
		await test.send({ url: '/Orders', method: 'GET' });

		expect(test.http.countFor('POST /Login')).toBe(1);
		expect(test.http.countFor('GET /Orders')).toBe(2);
		expect(test.http.callsFor('GET /Orders')[1].headers?.Cookie).toBe('B1SESSION=sess-1');
	});

	it('picks up a refreshed ROUTEID for the next request', async () => {
		const test = scenario({
			'POST /Login': LOGIN_OK,
			'GET /Orders': [
				{ statusCode: 200, body: {}, headers: { 'set-cookie': ['ROUTEID=.node2'] } },
				{ statusCode: 200, body: {} },
			],
		});

		await test.send({ url: '/Orders', method: 'GET' });
		await test.send({ url: '/Orders', method: 'GET' });

		expect(test.http.callsFor('GET /Orders')[1].headers?.Cookie).toBe(
			'B1SESSION=sess-1; ROUTEID=.node2',
		);
	});

	it('leaves an existing ROUTEID alone when a response carries no cookie', async () => {
		const test = scenario({
			'POST /Login': {
				statusCode: 200,
				body: { SessionId: 'sess-1' },
				headers: { 'set-cookie': ['B1SESSION=sess-1', 'ROUTEID=.node1'] },
			},
			'GET /Orders': { statusCode: 200, body: {} },
		});

		await test.send({ url: '/Orders', method: 'GET' });
		await test.send({ url: '/Orders', method: 'GET' });

		expect(test.http.callsFor('GET /Orders')[1].headers?.Cookie).toBe(
			'B1SESSION=sess-1; ROUTEID=.node1',
		);
	});
});

describe('serviceLayerApiRequest session recovery', () => {
	it('re-logs in and retries once when the Service Layer rejects the session', async () => {
		const test = scenario({
			'POST /Login': [LOGIN_OK, LOGIN_SECOND],
			'GET /Orders(45)': [SESSION_EXPIRED, { statusCode: 200, body: { DocEntry: 45 } }],
		});

		const result = await test.send({ url: '/Orders(45)', method: 'GET' });

		expect(result.body).toEqual({ DocEntry: 45 });
		expect(test.http.countFor('POST /Login')).toBe(2);
		expect(test.http.countFor('GET /Orders(45)')).toBe(2);

		const attempts = test.http.callsFor('GET /Orders(45)');
		expect(attempts[0].headers?.Cookie).toBe('B1SESSION=sess-1');
		expect(attempts[1].headers?.Cookie).toBe('B1SESSION=sess-2');
	});

	it('treats a 401 with no parseable SAP code as an expired session', async () => {
		const test = scenario({
			'POST /Login': [LOGIN_OK, LOGIN_SECOND],
			'GET /Orders': [{ statusCode: 401, body: {} }, { statusCode: 200, body: {} }],
		});

		await test.send({ url: '/Orders', method: 'GET' });

		expect(test.http.countFor('POST /Login')).toBe(2);
	});

	it('does not re-login for a 401 that carries a different SAP code', async () => {
		const test = scenario({
			'POST /Login': LOGIN_OK,
			'GET /Orders': {
				statusCode: 401,
				body: { error: { code: -1116, message: { value: 'Insufficient authorization.' } } },
			},
		});

		const error = await test
			.send({ url: '/Orders', method: 'GET' })
			.catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(NodeApiError);
		expect(test.http.countFor('POST /Login')).toBe(1);
		expect(test.http.countFor('GET /Orders')).toBe(1);
		expect(flattenErrorText(error)).toContain('Insufficient authorization.');
	});

	it('drops the replacement session when the retry is rejected as well', async () => {
		const test = scenario({
			'POST /Login': [LOGIN_OK, LOGIN_SECOND, { statusCode: 200, body: { SessionId: 'sess-3' } }],
			'GET /Orders': [SESSION_EXPIRED, SESSION_EXPIRED, { statusCode: 200, body: {} }],
		});

		await expect(test.send({ url: '/Orders', method: 'GET' })).rejects.toBeInstanceOf(
			NodeApiError,
		);
		expect(test.http.countFor('POST /Login')).toBe(2);

		// The refused session was discarded rather than handed to the next caller.
		await test.send({ url: '/Orders', method: 'GET' });
		expect(test.http.countFor('POST /Login')).toBe(3);
	});

	it.each([403, 500])('never retries a %i', async (statusCode) => {
		const test = scenario({
			'POST /Login': LOGIN_OK,
			'GET /Orders': { statusCode, body: { error: { message: 'Boom' } } },
		});

		await expect(test.send({ url: '/Orders', method: 'GET' })).rejects.toBeInstanceOf(
			NodeApiError,
		);
		expect(test.http.countFor('POST /Login')).toBe(1);
		expect(test.http.countFor('GET /Orders')).toBe(1);
	});

	it('reports an HTTP error without leaking the session or the password', async () => {
		const test = scenario({
			'POST /Login': LOGIN_OK,
			'GET /Orders': {
				statusCode: 500,
				body: {
					error: { message: { value: 'Internal error.' } },
					internalDetails: { cookie: 'B1SESSION=sess-1' },
				},
			},
		});

		const error = await test
			.send({ url: '/Orders', method: 'GET' })
			.catch((caught: unknown) => caught);

		const text = flattenErrorText(error);
		expect(text).toContain('Internal error.');
		expect(text).not.toContain('B1SESSION');
		expect(text).not.toContain(test.credentials.password);
	});

	it('sanitises a transport failure raised after login', async () => {
		const test = scenario({
			'POST /Login': LOGIN_OK,
			'GET /Orders': {
				rejectWith: {
					code: 'ECONNRESET',
					config: { headers: { Cookie: 'B1SESSION=sess-1' } },
				},
			},
		});

		const error = await test
			.send({ url: '/Orders', method: 'GET' })
			.catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(NodeApiError);

		const text = flattenErrorText(error);
		expect(text).toContain('Could not connect');
		expect(text).not.toContain('B1SESSION');
		expect(text).not.toContain(test.credentials.password);
	});
});

describe('fetchEntityCollection', () => {
	it('asks for the whole collection in one page when no limit is set', async () => {
		const test = scenario({
			'POST /Login': LOGIN_OK,
			'GET /Orders': { statusCode: 200, body: { value: [{ DocEntry: 1 }] } },
		});

		const rows = await test.collect('Orders', undefined);

		expect(rows).toEqual([{ DocEntry: 1 }]);
		expect(test.http.callsFor('GET /Orders')[0].headers?.Prefer).toBe('odata.maxpagesize=0');
	});

	it('asks for exactly the requested page size', async () => {
		const test = scenario({
			'POST /Login': LOGIN_OK,
			'GET /Orders': { statusCode: 200, body: { value: [{ DocEntry: 1 }] } },
		});

		await test.collect('Orders', 50);

		expect(test.http.callsFor('GET /Orders')[0].headers?.Prefer).toBe('odata.maxpagesize=50');
	});

	it('follows @odata.nextLink when a result is split across pages', async () => {
		const nextLink = 'https://sl.invalid:50000/b1s/v2/Orders?$skip=2';
		const test = scenario({
			'POST /Login': LOGIN_OK,
			'GET /Orders': {
				statusCode: 200,
				body: { value: [{ DocEntry: 1 }, { DocEntry: 2 }], '@odata.nextLink': nextLink },
			},
			[`GET ${nextLink}`]: { statusCode: 200, body: { value: [{ DocEntry: 3 }] } },
		});

		const rows = await test.collect('Orders', undefined);

		expect(rows).toEqual([{ DocEntry: 1 }, { DocEntry: 2 }, { DocEntry: 3 }]);
		expect(test.http.countFor(`GET ${nextLink}`)).toBe(1);
	});

	it('stops at the limit without following the next link', async () => {
		const test = scenario({
			'POST /Login': LOGIN_OK,
			'GET /Orders': {
				statusCode: 200,
				body: {
					value: [{ DocEntry: 1 }, { DocEntry: 2 }, { DocEntry: 3 }],
					'@odata.nextLink': 'https://sl.invalid:50000/b1s/v2/Orders?$skip=3',
				},
			},
		});

		const rows = await test.collect('Orders', 2);

		expect(rows).toEqual([{ DocEntry: 1 }, { DocEntry: 2 }]);
		expect(test.http.countFor('GET /Orders')).toBe(1);
	});

	it('stops on an empty page even when a next link is still advertised', async () => {
		const nextLink = 'https://sl.invalid:50000/b1s/v2/Orders?$skip=1';
		const test = scenario({
			'POST /Login': LOGIN_OK,
			'GET /Orders': {
				statusCode: 200,
				body: { value: [{ DocEntry: 1 }], '@odata.nextLink': nextLink },
			},
			[`GET ${nextLink}`]: {
				statusCode: 200,
				body: { value: [], '@odata.nextLink': nextLink },
			},
		});

		const rows = await test.collect('Orders', undefined);

		expect(rows).toEqual([{ DocEntry: 1 }]);
		expect(test.http.countFor(`GET ${nextLink}`)).toBe(1);
	});

	it('treats a page with no value member as the end of the collection', async () => {
		const test = scenario({
			'POST /Login': LOGIN_OK,
			'GET /Orders': { statusCode: 200, body: {} },
		});

		expect(await test.collect('Orders', undefined)).toEqual([]);
	});

	it('ignores an un-prefixed odata.nextLink', async () => {
		// Verified against a live v2 instance: the link is the OData V4 "@"-prefixed
		// form. Following the un-prefixed spelling some SAP docs imply would be wrong.
		const test = scenario({
			'POST /Login': LOGIN_OK,
			'GET /Orders': {
				statusCode: 200,
				body: {
					value: [{ DocEntry: 1 }],
					'odata.nextLink': 'https://sl.invalid:50000/b1s/v2/Orders?$skip=1',
				},
			},
		});

		expect(await test.collect('Orders', undefined)).toEqual([{ DocEntry: 1 }]);
		expect(test.http.calls).toHaveLength(2);
	});
});
