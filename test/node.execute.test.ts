import { NodeApiError, NodeOperationError } from 'n8n-workflow';
import type { INodeExecutionData } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { SapBusinessOneServiceLayer } from '../nodes/SapBusinessOneServiceLayer/SapBusinessOneServiceLayer.node';
import {
	EDMX_BOUND_OPERATIONS,
	EDMX_SERVICE_OPERATIONS,
	EDMX_STRUCTURED_PROPERTIES,
	SYNTHETIC_EDMX_V4,
} from './fixtures/metadataDocuments';
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

	it('rejects an unknown resource', async () => {
		const test = harness({ parameters: { resource: 'frobnicate' } });

		const error = await test.run().catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(NodeOperationError);
		expect(flattenErrorText(error)).toContain('Unknown resource "frobnicate"');
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

describe('Entity Set: complex and collection fields', () => {
	const STRUCTURED_METADATA: RouteTable = {
		'GET /$metadata': { statusCode: 200, body: EDMX_STRUCTURED_PROPERTIES },
	};

	it('sends lines and a complex property entered as JSON text as nested JSON', async () => {
		const test = harness({
			routes: {
				...STRUCTURED_METADATA,
				'POST /Orders': { statusCode: 201, body: { DocEntry: 9 } },
			},
			parameters: entitySetParams('create', {
				entityFields: mapperValue({
					CardCode: 'C1',
					DocumentStatus: 'bost_Open',
					AddressExtension: '{"ShipToStreet": "Main 1"}',
					DocumentLines: '[{"ItemCode": "A1", "Quantity": 2}]',
				}),
			}),
		});

		const output = await test.run();

		expect(test.http.callsFor('POST /Orders')[0].body).toEqual({
			CardCode: 'C1',
			DocumentStatus: 'bost_Open',
			AddressExtension: { ShipToStreet: 'Main 1' },
			DocumentLines: [{ ItemCode: 'A1', Quantity: 2 }],
		});
		expect(output[0][0].json).toEqual({ DocEntry: 9 });
	});

	it('uses structured values from an expression as-is', async () => {
		const test = harness({
			routes: { ...STRUCTURED_METADATA, 'POST /Orders': { statusCode: 201, body: {} } },
			parameters: entitySetParams('create', {
				entityFields: mapperValue({
					AddressExtension: { ShipToStreet: 'Main 1' },
					DocumentLines: [{ ItemCode: 'A1' }],
				}),
			}),
		});

		await test.run();

		expect(test.http.callsFor('POST /Orders')[0].body).toEqual({
			AddressExtension: { ShipToStreet: 'Main 1' },
			DocumentLines: [{ ItemCode: 'A1' }],
		});
	});

	it('patches lines and reports the parsed body it sent', async () => {
		const test = harness({
			routes: { ...STRUCTURED_METADATA, 'PATCH /Orders(45)': { statusCode: 204, body: '' } },
			parameters: entitySetParams('update', {
				keyFields: mapperValue({ DocEntry: 45 }),
				entityFields: mapperValue({
					CardCode: 'C2',
					DocumentLines: '[{"LineNum": 0, "Quantity": 5}]',
				}),
			}),
		});

		const output = await test.run();

		expect(test.http.callsFor('PATCH /Orders(45)')[0].body).toEqual({
			CardCode: 'C2',
			DocumentLines: [{ LineNum: 0, Quantity: 5 }],
		});
		expect(output[0][0].json).toEqual({
			success: true,
			entitySet: 'Orders',
			key: { DocEntry: 45 },
			CardCode: 'C2',
			DocumentLines: [{ LineNum: 0, Quantity: 5 }],
		});
	});

	it('leaves out a structured field that is empty at runtime, but sends an empty primitive', async () => {
		// The editor never stores an empty field; only an expression yields one.
		// An empty primitive is still sent, so a PATCH can clear a value.
		const test = harness({
			routes: { ...STRUCTURED_METADATA, 'PATCH /Orders(45)': { statusCode: 204, body: '' } },
			parameters: entitySetParams('update', {
				keyFields: mapperValue({ DocEntry: 45 }),
				entityFields: mapperValue({ CardCode: '', AddressExtension: '', DocumentLines: null }),
			}),
		});

		await test.run();

		expect(test.http.callsFor('PATCH /Orders(45)')[0].body).toEqual({ CardCode: '' });
	});

	it('sends an empty array, which is a value and not an empty field', async () => {
		const test = harness({
			routes: { ...STRUCTURED_METADATA, 'PATCH /Orders(45)': { statusCode: 204, body: '' } },
			parameters: entitySetParams('update', {
				keyFields: mapperValue({ DocEntry: 45 }),
				entityFields: mapperValue({ DocumentLines: '[]' }),
			}),
		});

		await test.run();

		expect(test.http.callsFor('PATCH /Orders(45)')[0].body).toEqual({ DocumentLines: [] });
	});

	it('passes a value for a property the metadata no longer declares through unchanged', async () => {
		const test = harness({
			routes: { ...STRUCTURED_METADATA, 'POST /Orders': { statusCode: 201, body: {} } },
			parameters: entitySetParams('create', {
				entityFields: mapperValue({ Stale: '[not json' }),
			}),
		});

		await test.run();

		expect(test.http.callsFor('POST /Orders')[0].body).toEqual({ Stale: '[not json' });
	});

	it('rejects invalid JSON before sending a request', async () => {
		const test = harness({
			routes: STRUCTURED_METADATA,
			parameters: entitySetParams('create', {
				entityFields: mapperValue({ DocumentLines: '[{"ItemCode": "A1",}]' }),
			}),
		});

		const error = await test.run().catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(NodeOperationError);
		expect(flattenErrorText(error)).toContain(
			'The value of field "DocumentLines" is not valid JSON',
		);
		expect(flattenErrorText(error)).toContain('Collection(SAPB1.DocumentLine)');
		expect(test.http.countFor('POST /Orders')).toBe(0);
	});

	it('rejects a JSON object where the property is a collection', async () => {
		const test = harness({
			routes: STRUCTURED_METADATA,
			parameters: entitySetParams('update', {
				keyFields: mapperValue({ DocEntry: 45 }),
				entityFields: mapperValue({ DocumentLines: '{"ItemCode": "A1"}' }),
			}),
		});

		const error = await test.run().catch((caught: unknown) => caught);

		expect(flattenErrorText(error)).toContain(
			'The value of field "DocumentLines" must be a JSON array',
		);
		expect(test.http.countFor('PATCH /Orders(45)')).toBe(0);
	});

	it('rejects a JSON array where the property is a single complex type', async () => {
		const test = harness({
			routes: STRUCTURED_METADATA,
			parameters: entitySetParams('create', {
				entityFields: mapperValue({ AddressExtension: '[]' }),
			}),
		});

		const error = await test.run().catch((caught: unknown) => caught);

		expect(flattenErrorText(error)).toContain(
			'The value of field "AddressExtension" must be a JSON object',
		);
	});

	it('collects the error on the item when continueOnFail is set and carries on', async () => {
		const test = harness({
			routes: {
				...STRUCTURED_METADATA,
				'POST /Orders': { statusCode: 201, body: { DocEntry: 9 } },
			},
			parameters: entitySetParams('create', {
				entityFields: (itemIndex: number) =>
					mapperValue({ DocumentLines: itemIndex === 0 ? 'nope' : '[]' }),
			}),
			items: [{ json: {} }, { json: {} }],
			continueOnFail: true,
		});

		const output = await test.run();

		expect(output[0]).toHaveLength(2);
		expect(output[0][0].pairedItem).toEqual({ item: 0 });
		expect(String(output[0][0].json.error)).toContain('is not valid JSON');
		expect(output[0][1].json).toEqual({ DocEntry: 9 });
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

const SERVICE_OPERATION_METADATA: RouteTable = {
	'GET /$metadata': { statusCode: 200, body: EDMX_SERVICE_OPERATIONS },
};

function serviceOperationParams(
	serviceOperation: string,
	values: Record<string, unknown> | null = null,
): Record<string, ParameterValue> {
	return {
		resource: 'serviceOperation',
		serviceOperation,
		operationParameters: mapperValue(values),
	};
}

describe('Service Operation', () => {
	it('calls a function without parameters with empty parentheses', async () => {
		const test = harness({
			routes: {
				...SERVICE_OPERATION_METADATA,
				'GET /CompanyService_GetCompanyInfo()': {
					statusCode: 200,
					body: { CompanyName: 'Demo' },
				},
			},
			parameters: serviceOperationParams('CompanyService_GetCompanyInfo'),
		});

		const output = await test.run();

		const [request] = test.http.callsFor('GET /CompanyService_GetCompanyInfo()');
		expect(request.body).toBeUndefined();
		expect(output).toEqual([[{ json: { CompanyName: 'Demo' }, pairedItem: { item: 0 } }]]);
	});

	it('encodes function parameters inline as OData literals, in metadata order', async () => {
		const path = "GET /SBOBobService_GetDueDate(CardCode='O''Brien%20%231',RefDate='20260101')";
		const test = harness({
			routes: { ...SERVICE_OPERATION_METADATA, [path]: { statusCode: 200, body: '20260131' } },
			parameters: serviceOperationParams('SBOBobService_GetDueDate', {
				RefDate: '20260101',
				CardCode: "O'Brien #1",
			}),
		});

		const output = await test.run();

		expect(test.http.countFor(path)).toBe(1);
		// A plain-text response is wrapped, exactly as a Custom API Call does.
		expect(output[0][0].json).toEqual({ data: '20260131' });
	});

	it('writes numeric function parameters unquoted', async () => {
		const path = 'GET /RateService_GetRate(Factor=1.5)';
		const test = harness({
			routes: { ...SERVICE_OPERATION_METADATA, [path]: { statusCode: 200, body: { value: 3 } } },
			parameters: serviceOperationParams('RateService_GetRate', { Factor: 1.5 }),
		});

		await test.run();

		expect(test.http.countFor(path)).toBe(1);
	});

	it('leaves empty fields and undeclared parameters out of a function call', async () => {
		const path = "GET /SBOBobService_GetDueDate(CardCode='C1')";
		const test = harness({
			routes: { ...SERVICE_OPERATION_METADATA, [path]: { statusCode: 200, body: 'x' } },
			parameters: serviceOperationParams('SBOBobService_GetDueDate', {
				CardCode: 'C1',
				RefDate: '',
				Stale: 'left over from another operation',
			}),
		});

		await test.run();

		expect(test.http.countFor(path)).toBe(1);
	});

	it('rejects a complex function parameter instead of sending it in the URL', async () => {
		const test = harness({
			routes: SERVICE_OPERATION_METADATA,
			parameters: serviceOperationParams('ReportService_GetReport', {
				ReportParams: '{"Code":"R1"}',
			}),
		});

		const error = await test.run().catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(NodeOperationError);
		expect(flattenErrorText(error)).toContain('cannot be sent in the URL');
		expect(test.http.calls.filter((call) => call.url?.startsWith('/ReportService'))).toEqual([]);
	});

	it('posts action parameters as a JSON body', async () => {
		const test = harness({
			routes: {
				...SERVICE_OPERATION_METADATA,
				'POST /SBOBobService_SetSystemPermission': { statusCode: 204, body: '' },
			},
			parameters: serviceOperationParams('SBOBobService_SetSystemPermission', {
				UserCode: 'manager',
				PermissionID: '',
				Permission: 0,
			}),
		});

		const output = await test.run();

		expect(test.http.callsFor('POST /SBOBobService_SetSystemPermission')[0].body).toEqual({
			UserCode: 'manager',
			Permission: 0,
		});
		expect(output[0][0].json).toEqual({ success: true, statusCode: 204 });
	});

	it('parses a complex parameter entered as JSON text', async () => {
		const test = harness({
			routes: {
				...SERVICE_OPERATION_METADATA,
				'POST /BankStatementsService_GetBankStatementList': {
					statusCode: 200,
					body: { value: [{ Sequence: 1 }] },
				},
			},
			parameters: serviceOperationParams('BankStatementsService_GetBankStatementList', {
				BankStatementParams: '{"BankAccountKey": 3}',
			}),
		});

		const output = await test.run();

		expect(test.http.callsFor('POST /BankStatementsService_GetBankStatementList')[0].body).toEqual({
			BankStatementParams: { BankAccountKey: 3 },
		});
		// Collections are returned unsplit, like a Custom API Call.
		expect(output[0]).toHaveLength(1);
		expect(output[0][0].json).toEqual({ value: [{ Sequence: 1 }] });
	});

	it('uses structured values from an expression as-is', async () => {
		const test = harness({
			routes: {
				...SERVICE_OPERATION_METADATA,
				'POST /BatchService_PostLines': { statusCode: 204, body: '' },
			},
			parameters: serviceOperationParams('BatchService_PostLines', {
				Lines: [{ LineNum: 0 }, { LineNum: 1 }],
			}),
		});

		await test.run();

		expect(test.http.callsFor('POST /BatchService_PostLines')[0].body).toEqual({
			Lines: [{ LineNum: 0 }, { LineNum: 1 }],
		});
	});

	it('posts an action without parameters without a body', async () => {
		const test = harness({
			routes: {
				...SERVICE_OPERATION_METADATA,
				'POST /CleanupService_Run': { statusCode: 204, body: '' },
			},
			parameters: serviceOperationParams('CleanupService_Run'),
		});

		await test.run();

		expect(test.http.callsFor('POST /CleanupService_Run')[0].body).toBeUndefined();
	});

	it.each([
		[
			'invalid JSON',
			'BankStatementsService_GetBankStatementList',
			'BankStatementParams',
			'{nope',
			'is not valid JSON',
		],
		[
			'an array for an object',
			'BankStatementsService_GetBankStatementList',
			'BankStatementParams',
			'[1]',
			'must be a JSON object',
		],
		[
			'an object for an array',
			'BatchService_PostLines',
			'Lines',
			'{"LineNum":0}',
			'must be a JSON array',
		],
		[
			'a scalar for an object',
			'BankStatementsService_GetBankStatementList',
			'BankStatementParams',
			'42',
			'must be a JSON object',
		],
	])(
		'rejects %s before sending the request',
		async (_case, operation, parameter, value, message) => {
			const test = harness({
				routes: SERVICE_OPERATION_METADATA,
				parameters: serviceOperationParams(operation, { [parameter]: value }),
			});

			const error = await test.run().catch((caught: unknown) => caught);

			expect(error).toBeInstanceOf(NodeOperationError);
			expect(flattenErrorText(error)).toContain(`parameter "${parameter}" ${message}`);
			expect(test.http.countFor(`POST /${operation}`)).toBe(0);
		},
	);

	it('rejects an operation the metadata does not describe', async () => {
		const test = harness({
			routes: SERVICE_OPERATION_METADATA,
			parameters: serviceOperationParams('NoSuchService_Run'),
		});

		const error = await test.run().catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(NodeOperationError);
		expect(flattenErrorText(error)).toContain('Unknown service operation "NoSuchService_Run"');
	});

	it('surfaces a Service Layer error as a node API error', async () => {
		const test = harness({
			routes: {
				...SERVICE_OPERATION_METADATA,
				'POST /CleanupService_Run': {
					statusCode: 400,
					body: { error: { code: -5002, message: { value: 'Operation failed' } } },
				},
			},
			parameters: serviceOperationParams('CleanupService_Run'),
		});

		const error = await test.run().catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(NodeApiError);
		expect(flattenErrorText(error)).toContain('Operation failed');
	});

	it('collects the error on the item when continueOnFail is set', async () => {
		const test = harness({
			routes: SERVICE_OPERATION_METADATA,
			parameters: serviceOperationParams('BatchService_PostLines', { Lines: '{nope' }),
			continueOnFail: true,
		});

		const output = await test.run();

		expect(output[0]).toHaveLength(1);
		expect(output[0][0].pairedItem).toEqual({ item: 0 });
		expect(String(output[0][0].json.error)).toContain('is not valid JSON');
	});
});

const BOUND_OPERATION_METADATA: RouteTable = {
	'GET /$metadata': { statusCode: 200, body: EDMX_BOUND_OPERATIONS },
};

function boundOperationParams(
	entitySet: string,
	boundOperation: string,
	keyValues: Record<string, unknown> | null,
	values: Record<string, unknown> | null = null,
): Record<string, ParameterValue> {
	return entitySetParams(
		'executeOperation',
		{
			boundOperation,
			keyFields: mapperValue(keyValues),
			boundOperationParameters: mapperValue(values),
		},
		entitySet,
	);
}

describe('Entity Set: Execute Action or Function', () => {
	it('posts a bound action without parameters without a body and reports a 204 as success', async () => {
		const test = harness({
			routes: {
				...BOUND_OPERATION_METADATA,
				'POST /Orders(45)/Close': { statusCode: 204, body: '' },
			},
			parameters: boundOperationParams('Orders', 'Close', { DocEntry: 45 }),
		});

		const output = await test.run();

		expect(test.http.callsFor('POST /Orders(45)/Close')[0].body).toBeUndefined();
		expect(output).toEqual([
			[{ json: { success: true, statusCode: 204 }, pairedItem: { item: 0 } }],
		]);
	});

	it('resolves a shared operation name through the selected entity set', async () => {
		const test = harness({
			routes: {
				...BOUND_OPERATION_METADATA,
				'POST /StockTransfers(7)/Close': { statusCode: 204, body: '' },
			},
			parameters: boundOperationParams('StockTransfers', 'Close', { DocEntry: 7 }),
		});

		await test.run();

		expect(test.http.countFor('POST /StockTransfers(7)/Close')).toBe(1);
	});

	it('posts bound action parameters as a JSON body, parsing complex ones', async () => {
		const test = harness({
			routes: {
				...BOUND_OPERATION_METADATA,
				'POST /Orders(45)/Reopen': { statusCode: 204, body: '' },
			},
			parameters: boundOperationParams(
				'Orders',
				'Reopen',
				{ DocEntry: 45 },
				{ Reason: 'Customer request', Options: '{"KeepLines":"tYES"}', Stale: 'x' },
			),
		});

		await test.run();

		expect(test.http.callsFor('POST /Orders(45)/Reopen')[0].body).toEqual({
			Reason: 'Customer request',
			Options: { KeepLines: 'tYES' },
		});
	});

	it('encodes a composite key into the bound operation path', async () => {
		const path = "GET /SalesTaxAuthorities(Type=-3,Code='A%26K')/Recalculate";
		const test = harness({
			routes: { ...BOUND_OPERATION_METADATA, [path]: { statusCode: 200, body: { Rate: 7 } } },
			parameters: boundOperationParams('SalesTaxAuthorities', 'Recalculate', {
				Type: -3,
				Code: 'A&K',
			}),
		});

		const output = await test.run();

		expect(test.http.countFor(path)).toBe(1);
		expect(output[0][0].json).toEqual({ Rate: 7 });
	});

	it('calls a bound function without parameters without parentheses', async () => {
		const path = "GET /SQLQueries('Q1')/List";
		const test = harness({
			routes: {
				...BOUND_OPERATION_METADATA,
				[path]: { statusCode: 200, body: { value: [{ CardCode: 'C1' }] } },
			},
			parameters: boundOperationParams('SQLQueries', 'List', { SqlCode: 'Q1' }),
		});

		const output = await test.run();

		expect(test.http.countFor(path)).toBe(1);
		expect(output[0][0].json).toEqual({ value: [{ CardCode: 'C1' }] });
	});

	it('sends bound function parameters as OData literal query options, in metadata order', async () => {
		const path = "GET /Orders(45)/GetStatus?Depth=2&Label='O''Brien%20%231'";
		const test = harness({
			routes: { ...BOUND_OPERATION_METADATA, [path]: { statusCode: 200, body: 'Open' } },
			parameters: boundOperationParams(
				'Orders',
				'GetStatus',
				{ DocEntry: 45 },
				{ Label: "O'Brien #1", Depth: 2 },
			),
		});

		const output = await test.run();

		expect(test.http.countFor(path)).toBe(1);
		// A plain-text response is wrapped, exactly as a Custom API Call does.
		expect(output[0][0].json).toEqual({ data: 'Open' });
	});

	it('rejects a complex bound function parameter instead of sending it in the URL', async () => {
		const test = harness({
			routes: BOUND_OPERATION_METADATA,
			parameters: boundOperationParams(
				'Orders',
				'GetStatus',
				{ DocEntry: 45 },
				{ Filter: '{"Open":true}' },
			),
		});

		const error = await test.run().catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(NodeOperationError);
		expect(flattenErrorText(error)).toContain('cannot be sent in the URL');
		expect(test.http.calls.filter((call) => call.url?.startsWith('/Orders'))).toEqual([]);
	});

	it("sends List's ParamList as the stored query's own query options", async () => {
		const path = "GET /SQLQueries('Q1')/List?code='O''Brien%20%231'&minTotal=100";
		const test = harness({
			routes: { ...BOUND_OPERATION_METADATA, [path]: { statusCode: 200, body: { value: [] } } },
			parameters: boundOperationParams(
				'SQLQueries',
				'List',
				{ SqlCode: 'Q1' },
				{ ParamList: " code='O''Brien #1' & minTotal = 100 &" },
			),
		});

		await test.run();

		expect(test.http.countFor(path)).toBe(1);
	});

	it.each([
		['an entry without a value', "code='C1'&minTotal"],
		['a system query option', '$top=1'],
	])('rejects a ParamList with %s before sending the request', async (_case, paramList) => {
		const test = harness({
			routes: BOUND_OPERATION_METADATA,
			parameters: boundOperationParams(
				'SQLQueries',
				'List',
				{ SqlCode: 'Q1' },
				{ ParamList: paramList },
			),
		});

		const error = await test.run().catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(NodeOperationError);
		expect(flattenErrorText(error)).toContain('is not in the form name=value');
		expect(test.http.calls.filter((call) => call.url?.startsWith('/SQLQueries'))).toEqual([]);
	});

	it('reports a missing key field instead of sending a request', async () => {
		const test = harness({
			routes: BOUND_OPERATION_METADATA,
			parameters: boundOperationParams('Orders', 'Close', null),
		});

		const error = await test.run().catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(NodeOperationError);
		expect(flattenErrorText(error)).toContain('Key field DocEntry has no value');
		expect(test.http.calls.filter((call) => call.url?.startsWith('/Orders'))).toEqual([]);
	});

	it('rejects an operation not bound to the selected entity set', async () => {
		const test = harness({
			routes: BOUND_OPERATION_METADATA,
			parameters: boundOperationParams('StockTransfers', 'Reopen', { DocEntry: 7 }),
		});

		const error = await test.run().catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(NodeOperationError);
		expect(flattenErrorText(error)).toContain(
			'Unknown action or function "Reopen" for entity set "StockTransfers"',
		);
	});

	it('surfaces a Service Layer error as a node API error', async () => {
		const test = harness({
			routes: {
				...BOUND_OPERATION_METADATA,
				'POST /Orders(45)/Close': {
					statusCode: 400,
					body: { error: { code: -5002, message: { value: 'Document is already closed' } } },
				},
			},
			parameters: boundOperationParams('Orders', 'Close', { DocEntry: 45 }),
		});

		const error = await test.run().catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(NodeApiError);
		expect(flattenErrorText(error)).toContain('Document is already closed');
	});

	it('collects the error on the item when continueOnFail is set and carries on', async () => {
		const test = harness({
			routes: {
				...BOUND_OPERATION_METADATA,
				'POST /Orders(46)/Cancel': { statusCode: 204, body: '' },
			},
			parameters: {
				...boundOperationParams('Orders', 'Cancel', null),
				keyFields: (itemIndex: number) => mapperValue(itemIndex === 0 ? {} : { DocEntry: 46 }),
			},
			items: [{ json: {} }, { json: {} }],
			continueOnFail: true,
		});

		const output = await test.run();

		expect(output).toEqual([
			[
				{ json: { error: 'Key field DocEntry has no value' }, pairedItem: { item: 0 } },
				{ json: { success: true, statusCode: 204 }, pairedItem: { item: 1 } },
			],
		]);
	});
});
