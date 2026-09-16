import { NodeApiError, NodeOperationError } from 'n8n-workflow';
import type { INodeExecutionData } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { SapBusinessOneServiceLayer } from '../nodes/SapBusinessOneServiceLayer/SapBusinessOneServiceLayer.node';
import { SYNTHETIC_EDMX_V4 } from './fixtures/metadataDocuments';
import { createTestCredentials } from './helpers/credentials';
import { flattenErrorText } from './helpers/errors';
import { createHttpFake, type FakeResponse, type RouteTable } from './helpers/http';
import {
	createExecuteFunctions,
	createTestNode,
	mapperValue,
	type ParameterValue,
} from './helpers/node';

const LOGIN_OK: FakeResponse = {
	statusCode: 200,
	body: { SessionId: 'sess-1', SessionTimeout: 30 },
};

const BASE_ROUTES: RouteTable = {
	'POST /Login': LOGIN_OK,
	'GET /$metadata': { statusCode: 200, body: SYNTHETIC_EDMX_V4 },
};

interface RunOptions {
	routes?: RouteTable;
	parameters: Record<string, ParameterValue>;
	items?: INodeExecutionData[];
	continueOnFail?: boolean;
	credentialId?: string | null;
}

function harness(options: RunOptions) {
	const http = createHttpFake({ ...BASE_ROUTES, ...(options.routes ?? {}) });
	const { credentials, credentialId } = createTestCredentials();
	const context = createExecuteFunctions({
		http,
		credentials,
		parameters: options.parameters,
		items: options.items,
		continueOnFail: options.continueOnFail,
		node: createTestNode(options.credentialId === undefined ? credentialId : options.credentialId),
	});
	const node = new SapBusinessOneServiceLayer();

	return {
		http,
		credentials,
		run: async () => await node.execute.call(context),
	};
}

function entitySetParams(
	operation: string,
	extra: Record<string, ParameterValue> = {},
	entitySet = 'Orders',
): Record<string, ParameterValue> {
	return { resource: 'entitySet', operation, entitySet, ...extra };
}

describe('Entity Set operations', () => {
	it('gets a single entity by its key', async () => {
		const test = harness({
			routes: { 'GET /Orders(45)': { statusCode: 200, body: { DocEntry: 45, CardCode: 'C1' } } },
			parameters: entitySetParams('get', { keyFields: mapperValue({ DocEntry: 45 }) }),
		});

		const output = await test.run();

		expect(test.http.callsFor('GET /Orders(45)')).toHaveLength(1);
		expect(output).toEqual([[{ json: { DocEntry: 45, CardCode: 'C1' }, pairedItem: { item: 0 } }]]);
	});

	it('encodes a composite key into the entity path', async () => {
		const test = harness({
			routes: { "GET /SalesTaxAuthorities(Type=-3,Code='AK')": { statusCode: 200, body: {} } },
			parameters: entitySetParams(
				'get',
				{ keyFields: mapperValue({ Code: 'AK', Type: -3 }) },
				'SalesTaxAuthorities',
			),
		});

		await test.run();

		expect(test.http.countFor("GET /SalesTaxAuthorities(Type=-3,Code='AK')")).toBe(1);
	});

	it('creates an entity from the mapped field values', async () => {
		const test = harness({
			routes: { 'POST /Orders': { statusCode: 201, body: { DocEntry: 9 } } },
			parameters: entitySetParams('create', {
				entityFields: mapperValue({ CardCode: 'C1', DocTotal: 12.5 }),
			}),
		});

		const output = await test.run();

		expect(test.http.callsFor('POST /Orders')[0].body).toEqual({
			CardCode: 'C1',
			DocTotal: 12.5,
		});
		expect(output[0][0].json).toEqual({ DocEntry: 9 });
	});

	it('patches an entity and reports what it sent', async () => {
		const test = harness({
			routes: { 'PATCH /Orders(45)': { statusCode: 204, body: '' } },
			parameters: entitySetParams('update', {
				keyFields: mapperValue({ DocEntry: 45 }),
				entityFields: mapperValue({ CardCode: 'C2' }),
			}),
		});

		const output = await test.run();

		const [request] = test.http.callsFor('PATCH /Orders(45)');
		expect(request.body).toEqual({ CardCode: 'C2' });
		// json is deliberately left at its default so a failed PATCH's error body
		// still parses; asserting it stays unset locks that decision in.
		expect(request.json).toBeUndefined();
		expect(output[0][0].json).toEqual({
			success: true,
			entitySet: 'Orders',
			key: { DocEntry: 45 },
			CardCode: 'C2',
		});
	});

	it('deletes an entity and reports the key it used', async () => {
		const test = harness({
			routes: { 'DELETE /Orders(45)': { statusCode: 204, body: '' } },
			parameters: entitySetParams('delete', { keyFields: mapperValue({ DocEntry: 45 }) }),
		});

		const output = await test.run();

		expect(test.http.callsFor('DELETE /Orders(45)')[0].body).toBeUndefined();
		expect(output[0][0].json).toEqual({
			success: true,
			entitySet: 'Orders',
			key: { DocEntry: 45 },
		});
	});

	it('returns every row when Return All is set', async () => {
		const test = harness({
			routes: {
				'GET /Orders': { statusCode: 200, body: { value: [{ DocEntry: 1 }, { DocEntry: 2 }] } },
			},
			parameters: entitySetParams('getMany', { returnAll: true }),
		});

		const output = await test.run();

		expect(test.http.callsFor('GET /Orders')[0].headers?.Prefer).toBe('odata.maxpagesize=0');
		expect(output[0]).toEqual([
			{ json: { DocEntry: 1 }, pairedItem: { item: 0 } },
			{ json: { DocEntry: 2 }, pairedItem: { item: 0 } },
		]);
	});

	it('asks for and returns no more than the limit', async () => {
		const test = harness({
			routes: {
				'GET /Orders': {
					statusCode: 200,
					body: { value: [{ DocEntry: 1 }, { DocEntry: 2 }, { DocEntry: 3 }] },
				},
			},
			parameters: entitySetParams('getMany', { returnAll: false, limit: 2 }),
		});

		const output = await test.run();

		expect(test.http.callsFor('GET /Orders')[0].headers?.Prefer).toBe('odata.maxpagesize=2');
		expect(output[0]).toHaveLength(2);
	});
});

describe('Entity Set error handling', () => {
	it('rejects an entity set the connected instance does not expose', async () => {
		const test = harness({
			parameters: entitySetParams('get', { keyFields: mapperValue({ DocEntry: 1 }) }, 'Nope'),
		});

		const error = await test.run().catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(NodeOperationError);
		expect(flattenErrorText(error)).toContain('Unknown entity set "Nope"');
	});

	it('rejects a resource that has no operations yet', async () => {
		const test = harness({ parameters: { resource: 'serviceOperation' } });

		const error = await test.run().catch((caught: unknown) => caught);

		expect(flattenErrorText(error)).toContain('no operations implemented yet');
	});

	it('rejects an unknown operation', async () => {
		const test = harness({ parameters: entitySetParams('frobnicate') });

		const error = await test.run().catch((caught: unknown) => caught);

		expect(flattenErrorText(error)).toContain('Unknown operation "frobnicate"');
	});

	it('reports a missing key field instead of sending a request', async () => {
		const test = harness({
			parameters: entitySetParams('get', { keyFields: mapperValue({}) }),
		});

		const error = await test.run().catch((caught: unknown) => caught);

		expect(flattenErrorText(error)).toContain('Key field DocEntry has no value');
		expect(test.http.countFor('GET /Orders()')).toBe(0);
	});

	it('collects the error on the item when continueOnFail is set', async () => {
		const test = harness({
			parameters: entitySetParams('get', { keyFields: mapperValue({}) }),
			continueOnFail: true,
		});

		const output = await test.run();

		expect(output[0]).toHaveLength(1);
		expect(output[0][0].pairedItem).toEqual({ item: 0 });
		expect(String(output[0][0].json.error)).toContain('Key field DocEntry has no value');
	});
});

describe('Entity Set across multiple items', () => {
	it('pairs each output with the item it came from and shares one session', async () => {
		const test = harness({
			routes: {
				'GET /Orders(45)': { statusCode: 200, body: { DocEntry: 45 } },
				'GET /Orders(46)': { statusCode: 200, body: { DocEntry: 46 } },
			},
			items: [{ json: {} }, { json: {} }],
			parameters: entitySetParams('get', {
				keyFields: (itemIndex: number) => mapperValue({ DocEntry: 45 + itemIndex }),
			}),
		});

		const output = await test.run();

		expect(output[0]).toEqual([
			{ json: { DocEntry: 45 }, pairedItem: { item: 0 } },
			{ json: { DocEntry: 46 }, pairedItem: { item: 1 } },
		]);
		// One login and one metadata fetch serve every item.
		expect(test.http.countFor('POST /Login')).toBe(1);
		expect(test.http.countFor('GET /$metadata')).toBe(1);
	});

	it('works when the credential was never saved through the n8n UI', async () => {
		const test = harness({
			routes: { 'GET /Orders(45)': { statusCode: 200, body: { DocEntry: 45 } } },
			credentialId: null,
			parameters: entitySetParams('get', { keyFields: mapperValue({ DocEntry: 45 }) }),
		});

		await expect(test.run()).resolves.toHaveLength(1);
	});
});

function customCallParams(
	method: string,
	endpoint: string,
	jsonBody: unknown = '',
): Record<string, ParameterValue> {
	return { resource: 'customApiCall', method, endpoint, jsonBody };
}

describe('Custom API Call', () => {
	it('sends a GET with the query string inline and returns the body unsplit', async () => {
		const endpoint = '/Orders?$top=10&$orderby=DocEntry desc';
		const body = { value: [{ DocEntry: 2 }, { DocEntry: 1 }] };
		const test = harness({
			routes: { [`GET ${endpoint}`]: { statusCode: 200, body } },
			parameters: customCallParams('GET', endpoint),
		});

		const output = await test.run();

		const [request] = test.http.callsFor(`GET ${endpoint}`);
		expect(request.body).toBeUndefined();
		expect(request.qs).toBeUndefined();
		expect(output).toEqual([[{ json: body, pairedItem: { item: 0 } }]]);
	});

	it('adds the leading slash and never fetches metadata', async () => {
		const test = harness({
			routes: {
				'GET /CompanyService_GetCompanyInfo()': { statusCode: 200, body: { CompanyName: 'X' } },
			},
			parameters: customCallParams('GET', 'CompanyService_GetCompanyInfo()'),
		});

		await test.run();

		expect(test.http.countFor('GET /CompanyService_GetCompanyInfo()')).toBe(1);
		expect(test.http.countFor('GET /$metadata')).toBe(0);
	});

	it.each(['POST', 'PATCH', 'PUT'])('sends the parsed JSON body with %s', async (method) => {
		const test = harness({
			routes: { [`${method} /Orders(45)`]: { statusCode: 200, body: { ok: 1 } } },
			parameters: customCallParams(method, '/Orders(45)', '{"Comments":"hi","Lines":[1]}'),
		});

		await test.run();

		expect(test.http.callsFor(`${method} /Orders(45)`)[0].body).toEqual({
			Comments: 'hi',
			Lines: [1],
		});
	});

	it('uses an object body from an expression as-is', async () => {
		const test = harness({
			routes: { 'POST /Orders': { statusCode: 201, body: { DocEntry: 9 } } },
			parameters: customCallParams('POST', '/Orders', { CardCode: 'C1' }),
		});

		const output = await test.run();

		expect(test.http.callsFor('POST /Orders')[0].body).toEqual({ CardCode: 'C1' });
		expect(output[0][0].json).toEqual({ DocEntry: 9 });
	});

	it('sends no body for an empty JSON field and reports a 204 as success', async () => {
		const test = harness({
			routes: { 'POST /Orders(45)/Close': { statusCode: 204, body: '' } },
			parameters: customCallParams('POST', '/Orders(45)/Close'),
		});

		const output = await test.run();

		expect(test.http.callsFor('POST /Orders(45)/Close')[0]).not.toHaveProperty('body');
		expect(output[0][0].json).toEqual({ success: true, statusCode: 204 });
	});

	it.each(['GET', 'DELETE'])('never reads or sends a body with %s', async (method) => {
		const test = harness({
			routes: { [`${method} /Orders(45)`]: { statusCode: 204, body: '' } },
			// Only these three parameters are configured; reading jsonBody would throw.
			parameters: { resource: 'customApiCall', method, endpoint: '/Orders(45)' },
		});

		await test.run();

		expect(test.http.callsFor(`${method} /Orders(45)`)[0]).not.toHaveProperty('body');
	});

	it.each([
		['invalid JSON', customCallParams('POST', '/Orders', '{nope'), 'The JSON body is not valid JSON'],
		[
			'an absolute URL',
			customCallParams('GET', 'https://evil.invalid/Orders'),
			'Only relative Service Layer endpoints are allowed',
		],
		[
			'a protocol-relative URL',
			customCallParams('GET', '//evil.invalid/Orders'),
			'Only relative Service Layer endpoints are allowed',
		],
		[
			'path traversal',
			customCallParams('GET', '/../Orders'),
			'The endpoint must not contain ".." path segments',
		],
		[
			'the Login endpoint',
			customCallParams('POST', '/Login', '{}'),
			'The Login and Logout endpoints cannot be called directly',
		],
		[
			'the Logout endpoint',
			customCallParams('POST', '/Logout'),
			'The Login and Logout endpoints cannot be called directly',
		],
	])('rejects %s before logging in', async (_label, parameters, message) => {
		const test = harness({ parameters });

		const error = await test.run().catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(NodeOperationError);
		expect(flattenErrorText(error)).toContain(message);
		expect(test.http.calls).toHaveLength(0);
	});

	it('logs in again and retries once when the session has expired', async () => {
		const test = harness({
			routes: {
				'POST /Login': [LOGIN_OK, { statusCode: 200, body: { SessionId: 'sess-2', SessionTimeout: 30 } }],
				'GET /Orders(45)': [
					{ statusCode: 401, body: { error: { code: 301, message: 'Invalid session' } } },
					{ statusCode: 200, body: { DocEntry: 45 } },
				],
			},
			parameters: customCallParams('GET', '/Orders(45)'),
		});

		const output = await test.run();

		expect(test.http.countFor('POST /Login')).toBe(2);
		const retried = test.http.callsFor('GET /Orders(45)')[1];
		expect(retried.headers?.Cookie).toBe('B1SESSION=sess-2');
		expect(output[0][0].json).toEqual({ DocEntry: 45 });
	});

	it('surfaces a Service Layer error as a NodeApiError', async () => {
		const test = harness({
			routes: {
				'GET /Orders(999)': {
					statusCode: 404,
					body: { error: { code: -2028, message: 'No matching records found' } },
				},
			},
			parameters: customCallParams('GET', '/Orders(999)'),
		});

		const error = await test.run().catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(NodeApiError);
		expect(flattenErrorText(error)).toContain('No matching records found');
	});

	it('collects the error on the item when continueOnFail is set', async () => {
		const test = harness({
			parameters: customCallParams('GET', 'https://evil.invalid/Orders'),
			continueOnFail: true,
		});

		const output = await test.run();

		expect(output[0]).toEqual([
			{
				json: { error: 'Only relative Service Layer endpoints are allowed' },
				pairedItem: { item: 0 },
			},
		]);
	});

	it('keeps credentials and session cookies out of the output', async () => {
		const test = harness({
			routes: { 'GET /Orders(45)': { statusCode: 200, body: { DocEntry: 45 } } },
			parameters: customCallParams('GET', '/Orders(45)'),
		});

		const serialized = JSON.stringify(await test.run());

		expect(serialized).not.toContain(test.credentials.password);
		expect(serialized).not.toContain('B1SESSION');
		expect(serialized).not.toContain('sess-1');
	});
});

describe('Node output hygiene', () => {
	it.each([
		['a successful run', false],
		['a continueOnFail run', true],
	])('keeps credentials and session cookies out of the output for %s', async (_label, failing) => {
		const test = harness({
			routes: { 'GET /Orders(45)': { statusCode: 200, body: { DocEntry: 45 } } },
			continueOnFail: failing,
			parameters: entitySetParams('get', {
				keyFields: mapperValue(failing ? {} : { DocEntry: 45 }),
			}),
		});

		const output = await test.run();
		const serialized = JSON.stringify(output);

		expect(serialized).not.toContain(test.credentials.password);
		expect(serialized).not.toContain('B1SESSION');
		expect(serialized).not.toContain('sess-1');
	});
});
