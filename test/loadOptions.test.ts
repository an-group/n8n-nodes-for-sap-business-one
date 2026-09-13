import { NodeApiError, NodeOperationError } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { SERVICE_LAYER_CREDENTIAL_NAME } from '../nodes/SapBusinessOneServiceLayer/helpers/credentials';
import { getEntitySets } from '../nodes/SapBusinessOneServiceLayer/methods/loadOptions';
import { EDMX_EMPTY, EDMX_V1, SYNTHETIC_EDMX_V4 } from './fixtures/metadataDocuments';
import { createTestCredentials } from './helpers/credentials';
import { flattenErrorText } from './helpers/errors';
import { createHttpFake, type FakeResponse, type RouteTable } from './helpers/http';
import { createLoadOptionsFunctions, createTestNode } from './helpers/node';

const LOGIN_OK: FakeResponse = {
	statusCode: 200,
	body: { SessionId: 'sess-1', SessionTimeout: 30 },
};

const LOGIN_REJECTED: FakeResponse = {
	statusCode: 401,
	body: { error: { code: -304, message: { value: 'Invalid company or user' } } },
};

interface ScenarioOptions {
	metadataXml?: string;
	routes?: RouteTable;
}

function scenario(options: ScenarioOptions = {}) {
	const http = createHttpFake({
		'POST /Login': LOGIN_OK,
		'GET /$metadata': { statusCode: 200, body: options.metadataXml ?? SYNTHETIC_EDMX_V4 },
		...(options.routes ?? {}),
	});
	const { credentials, credentialId } = createTestCredentials();
	const { context, credentialCalls } = createLoadOptionsFunctions({
		http,
		credentials,
		node: createTestNode(credentialId),
	});

	return { http, credentials, context, credentialCalls };
}

describe('getEntitySets', () => {
	it('lists every entity set in the container, sorted by name', async () => {
		const { context } = scenario();

		// The fixture declares them Orders, SalesTaxAuthorities, Items, Ghosts,
		// Reports — so this order can only come from the sort, not from parsing.
		await expect(getEntitySets.call(context)).resolves.toEqual([
			{ name: 'Ghosts', value: 'Ghosts' },
			{ name: 'Items', value: 'Items' },
			{ name: 'Orders', value: 'Orders' },
			{ name: 'Reports', value: 'Reports' },
			{ name: 'SalesTaxAuthorities', value: 'SalesTaxAuthorities' },
		]);
	});

	it('omits entity sets declared outside the EntityContainer', async () => {
		const { context } = scenario();

		const options = await getEntitySets.call(context);

		expect(options.map((option) => option.value)).not.toContain('OutsideContainer');
	});

	it('returns an empty list rather than failing when the schema declares none', async () => {
		const { context } = scenario({ metadataXml: EDMX_EMPTY });

		await expect(getEntitySets.call(context)).resolves.toEqual([]);
	});

	it('resolves the credentials without an item index', async () => {
		const { context, credentialCalls } = scenario();

		await getEntitySets.call(context);

		// There is no item in a loadOptions context. Threading one through would
		// only break once the node ran inside n8n.
		expect(credentialCalls).toEqual([
			{ type: SERVICE_LAYER_CREDENTIAL_NAME, itemIndex: undefined },
		]);
	});

	it('fetches the metadata once and serves a repeat call from the cache', async () => {
		const { context, http } = scenario();

		await getEntitySets.call(context);
		await getEntitySets.call(context);

		expect(http.countFor('GET /$metadata')).toBe(1);
		expect(http.countFor('POST /Login')).toBe(1);
	});

	it('rejects metadata from the v1 API', async () => {
		const { context } = scenario({ metadataXml: EDMX_V1 });

		await expect(getEntitySets.call(context)).rejects.toThrow(NodeOperationError);
	});

	it('surfaces a rejected login as a node API error', async () => {
		const { context } = scenario({ routes: { 'POST /Login': LOGIN_REJECTED } });

		await expect(getEntitySets.call(context)).rejects.toThrow(NodeApiError);
	});

	it('never leaks credentials or session material into a failure', async () => {
		const { context, credentials } = scenario({ routes: { 'POST /Login': LOGIN_REJECTED } });

		const caught = await getEntitySets.call(context).catch((error: unknown) => error);
		const text = flattenErrorText(caught);

		// Proves the flattening found something, so the assertions below cannot
		// pass against an empty string.
		expect(text).toContain('Invalid company or user');
		expect(text).not.toContain(credentials.password);
		expect(text).not.toContain('B1SESSION');
		expect(text).not.toContain(credentials.baseUrl);
	});
});
