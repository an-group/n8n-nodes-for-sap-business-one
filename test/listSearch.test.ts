import { NodeApiError, NodeOperationError } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { SERVICE_LAYER_CREDENTIAL_NAME } from '../nodes/SapBusinessOneServiceLayer/helpers/credentials';
import {
	searchBoundOperations,
	searchEntitySets,
	searchServiceOperations,
} from '../nodes/SapBusinessOneServiceLayer/methods/listSearch';
import {
	EDMX_BOUND_OPERATIONS,
	EDMX_EMPTY,
	EDMX_SERVICE_OPERATIONS,
	EDMX_V1,
	SYNTHETIC_EDMX_V4,
} from './fixtures/metadataDocuments';
import { createTestCredentials } from './helpers/credentials';
import { flattenErrorText } from './helpers/errors';
import { createHttpFake, type FakeResponse, type RouteTable } from './helpers/http';
import { createLoadOptionsFunctions, createTestNode, locatorValue } from './helpers/node';

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
	parameters?: Record<string, unknown>;
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
		parameters: options.parameters,
		node: createTestNode(credentialId),
	});

	return { http, credentials, context, credentialCalls };
}

describe('searchEntitySets', () => {
	it('lists every entity set in the container, sorted by name', async () => {
		const { context } = scenario();

		// The fixture declares them Orders, SalesTaxAuthorities, Items, Ghosts,
		// Reports — so this order can only come from the sort, not from parsing.
		await expect(searchEntitySets.call(context)).resolves.toEqual({
			results: [
				{ name: 'Ghosts', value: 'Ghosts' },
				{ name: 'Items', value: 'Items' },
				{ name: 'Orders', value: 'Orders' },
				{ name: 'Reports', value: 'Reports' },
				{ name: 'SalesTaxAuthorities', value: 'SalesTaxAuthorities' },
			],
		});
	});

	it('keeps only the entity sets whose name contains the search text, ignoring case', async () => {
		const { context } = scenario();

		const { results } = await searchEntitySets.call(context, 'OR');

		expect(results.map((result) => result.value)).toEqual(['Orders', 'Reports', 'SalesTaxAuthorities']);
	});

	it('treats a blank search text as no search', async () => {
		const { context } = scenario();

		const { results } = await searchEntitySets.call(context, '   ');

		expect(results).toHaveLength(5);
	});

	it('returns no entries for a search text nothing matches', async () => {
		const { context } = scenario();

		await expect(searchEntitySets.call(context, 'NoSuchSet')).resolves.toEqual({ results: [] });
	});

	it('omits entity sets declared outside the EntityContainer', async () => {
		const { context } = scenario();

		const { results } = await searchEntitySets.call(context);

		expect(results.map((result) => result.value)).not.toContain('OutsideContainer');
	});

	it('returns an empty list rather than failing when the schema declares none', async () => {
		const { context } = scenario({ metadataXml: EDMX_EMPTY });

		await expect(searchEntitySets.call(context)).resolves.toEqual({ results: [] });
	});

	it('resolves the credentials without an item index', async () => {
		const { context, credentialCalls } = scenario();

		await searchEntitySets.call(context);

		// There is no item in a list search context. Threading one through would
		// only break once the node ran inside n8n.
		expect(credentialCalls).toEqual([
			{ type: SERVICE_LAYER_CREDENTIAL_NAME, itemIndex: undefined },
		]);
	});

	it('fetches the metadata once and serves a repeat search from the cache', async () => {
		const { context, http } = scenario();

		await searchEntitySets.call(context);
		await searchEntitySets.call(context, 'Ord');

		expect(http.countFor('GET /$metadata')).toBe(1);
		expect(http.countFor('POST /Login')).toBe(1);
	});

	it('rejects metadata from the v1 API', async () => {
		const { context } = scenario({ metadataXml: EDMX_V1 });

		await expect(searchEntitySets.call(context)).rejects.toThrow(NodeOperationError);
	});

	it('surfaces a rejected login as a node API error', async () => {
		const { context } = scenario({ routes: { 'POST /Login': LOGIN_REJECTED } });

		await expect(searchEntitySets.call(context)).rejects.toThrow(NodeApiError);
	});

	it('never leaks credentials or session material into a failure', async () => {
		const { context, credentials } = scenario({ routes: { 'POST /Login': LOGIN_REJECTED } });

		const caught = await searchEntitySets.call(context).catch((error: unknown) => error);
		const text = flattenErrorText(caught);

		// Proves the flattening found something, so the assertions below cannot
		// pass against an empty string.
		expect(text).toContain('Invalid company or user');
		expect(text).not.toContain(credentials.password);
		expect(text).not.toContain('B1SESSION');
		expect(text).not.toContain(credentials.baseUrl);
	});
});

describe('searchServiceOperations', () => {
	it('lists every unbound operation sorted by name, with its kind in the label', async () => {
		const { context } = scenario({ metadataXml: EDMX_SERVICE_OPERATIONS });

		await expect(searchServiceOperations.call(context)).resolves.toEqual({
			results: [
				{
					name: 'BankStatementsService_GetBankStatementList (Action)',
					value: 'BankStatementsService_GetBankStatementList',
				},
				{ name: 'BatchService_PostLines (Action)', value: 'BatchService_PostLines' },
				{ name: 'CleanupService_Run (Action)', value: 'CleanupService_Run' },
				{
					name: 'CompanyService_GetCompanyInfo (Function)',
					value: 'CompanyService_GetCompanyInfo',
				},
				{ name: 'RateService_GetRate (Function)', value: 'RateService_GetRate' },
				{ name: 'ReportService_GetReport (Function)', value: 'ReportService_GetReport' },
				{ name: 'SBOBobService_GetDueDate (Function)', value: 'SBOBobService_GetDueDate' },
				{
					name: 'SBOBobService_SetSystemPermission (Action)',
					value: 'SBOBobService_SetSystemPermission',
				},
			],
		});
	});

	it('searches the label, so the kind can be searched for too', async () => {
		const { context } = scenario({ metadataXml: EDMX_SERVICE_OPERATIONS });

		const bySbo = await searchServiceOperations.call(context, 'sbobob');
		const byKind = await searchServiceOperations.call(context, '(function)');

		expect(bySbo.results.map((result) => result.value)).toEqual([
			'SBOBobService_GetDueDate',
			'SBOBobService_SetSystemPermission',
		]);
		expect(byKind.results.map((result) => result.value)).toEqual([
			'CompanyService_GetCompanyInfo',
			'RateService_GetRate',
			'ReportService_GetReport',
			'SBOBobService_GetDueDate',
		]);
	});

	it('omits bound operations', async () => {
		const { context } = scenario();

		const { results } = await searchServiceOperations.call(context);
		const values = results.map((result) => result.value);

		expect(values).not.toContain('Close');
		expect(values).not.toContain('GetOrderStatus');
	});

	it('returns an empty list rather than failing when the schema declares none', async () => {
		const { context } = scenario({ metadataXml: EDMX_EMPTY });

		await expect(searchServiceOperations.call(context)).resolves.toEqual({ results: [] });
	});

	it('shares the cached metadata with the entity set list', async () => {
		const { context, http } = scenario();

		await searchEntitySets.call(context);
		await searchServiceOperations.call(context);

		expect(http.countFor('GET /$metadata')).toBe(1);
	});
});

async function boundOperationsFor(entitySet: unknown, filter?: string) {
	const { context, http } = scenario({
		metadataXml: EDMX_BOUND_OPERATIONS,
		parameters: { entitySet },
	});

	return { results: (await searchBoundOperations.call(context, filter)).results, http };
}

describe('searchBoundOperations', () => {
	it("lists the entity set's own actions and functions sorted by name, with the kind in the label", async () => {
		const { results } = await boundOperationsFor(locatorValue('Orders'));

		expect(results).toEqual([
			{ name: 'Cancel (Action)', value: 'Cancel' },
			{ name: 'Close (Action)', value: 'Close' },
			{ name: 'GetStatus (Function)', value: 'GetStatus' },
			{ name: 'Reopen (Action)', value: 'Reopen' },
		]);
	});

	it('reads an entity set entered by name', async () => {
		const { results } = await boundOperationsFor(locatorValue('StockTransfers', 'name'));

		expect(results).toEqual([{ name: 'Close (Action)', value: 'Close' }]);
	});

	it('still reads a plain string entity set', async () => {
		const { results } = await boundOperationsFor('SQLQueries');

		expect(results).toEqual([{ name: 'List (Function)', value: 'List' }]);
	});

	it('keeps only the operations whose label contains the search text', async () => {
		const { results } = await boundOperationsFor(locatorValue('Orders'), 'CLO');

		expect(results.map((result) => result.value)).toEqual(['Close']);
	});

	it('returns an empty list for an entity set that binds nothing', async () => {
		const { results } = await boundOperationsFor(locatorValue('Warehouses'));

		expect(results).toEqual([]);
	});

	it('returns an empty list for an entity set the metadata does not describe', async () => {
		const { results } = await boundOperationsFor(locatorValue('NoSuchSet'));

		expect(results).toEqual([]);
	});

	it('stays empty, and fetches nothing, while no entity set is selected', async () => {
		const { results, http } = await boundOperationsFor(locatorValue(''));

		expect(results).toEqual([]);
		expect(http.calls).toHaveLength(0);
	});
});
