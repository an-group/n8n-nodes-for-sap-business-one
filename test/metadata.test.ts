import { NodeOperationError } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import {
	getServiceLayerMetadata,
	parseMetadataXml,
} from '../nodes/SapBusinessOneServiceLayer/helpers/metadata';
import type { EntityDefinition } from '../nodes/SapBusinessOneServiceLayer/helpers/types';
import {
	EDMX_BROKEN_ENTITY_SET,
	EDMX_COMPLEX_AND_ENUM_TYPES,
	EDMX_EMPTY,
	EDMX_NO_VERSION,
	EDMX_V1,
	SYNTHETIC_EDMX_V4,
} from './fixtures/metadataDocuments';
import { createTestCredentials } from './helpers/credentials';
import { flattenErrorText } from './helpers/errors';
import { createDeferred, createHttpFake, type FakeResponse } from './helpers/http';
import { createRequestContext } from './helpers/node';

const LOGIN_OK: FakeResponse = {
	statusCode: 200,
	body: { SessionId: 'sess-1', SessionTimeout: 30 },
};

function entityOf(entitySetName: string): EntityDefinition {
	const entity = parseMetadataXml(SYNTHETIC_EDMX_V4).entities.get(entitySetName);

	if (entity === undefined) {
		throw new Error(`fixture is missing the entity set ${entitySetName}`);
	}

	return entity;
}

describe('parseMetadataXml', () => {
	it('resolves only the entity sets declared inside the EntityContainer', () => {
		const { entities } = parseMetadataXml(SYNTHETIC_EDMX_V4);

		expect([...entities.keys()]).toEqual([
			'Orders',
			'SalesTaxAuthorities',
			'Items',
			'Ghosts',
			'Reports',
		]);
		expect(entities.has('OutsideContainer')).toBe(false);
	});

	it('strips the schema namespace from the entity type name', () => {
		expect(entityOf('Orders').entityTypeName).toBe('Order');
	});

	it('resolves a simple key to its EDM type and literal kind', () => {
		expect(entityOf('Orders').keys).toEqual([
			{ name: 'DocEntry', edmType: 'Edm.Int32', literalKind: 'numeric' },
		]);
	});

	it('resolves a composite key in metadata declaration order', () => {
		expect(entityOf('SalesTaxAuthorities').keys).toEqual([
			{ name: 'Type', edmType: 'Edm.Int32', literalKind: 'numeric' },
			{ name: 'Code', edmType: 'Edm.String', literalKind: 'string' },
		]);
	});

	it('drops a key whose property is not declared on the entity type', () => {
		expect(entityOf('Ghosts').keys).toEqual([]);
	});

	it('yields an empty key list for an entity type with no Key block', () => {
		expect(entityOf('Reports').keys).toEqual([]);
	});

	it('keeps the Collection(...) wrapper of a collection-valued property in its type', () => {
		const byName = new Map(entityOf('Orders').properties.map((p) => [p.name, p]));

		expect(byName.get('DocumentLines')?.edmType).toMatch(/^Collection\(/);
		expect(byName.get('CardCode')?.edmType).toBe('Edm.String');
	});

	it('reads nullability, defaulting to nullable when the attribute is absent', () => {
		const byName = new Map(entityOf('Orders').properties.map((p) => [p.name, p]));

		expect(byName.get('DocEntry')?.nullable).toBe(false);
		expect(byName.get('DocTotal')?.nullable).toBe(true);
	});

	it('attaches a bound action to its binding entity type', () => {
		expect(entityOf('Orders').boundActions).toEqual([
			{ name: 'Close', kind: 'action', bindingEntityType: 'Order', parameters: [] },
		]);
	});

	it('excludes the binding parameter from a bound function', () => {
		const [operation] = entityOf('Orders').boundFunctions;

		expect(operation.name).toBe('GetOrderStatus');
		expect(operation.bindingEntityType).toBe('Order');
		expect(operation.parameters).toEqual([
			{
				name: 'IncludeHistory',
				edmType: 'Edm.Boolean',
				literalKind: 'numeric',
				nullable: false,
			},
		]);
	});

	it('gives an entity type with no bound operations empty lists', () => {
		expect(entityOf('Items').boundActions).toEqual([]);
		expect(entityOf('Items').boundFunctions).toEqual([]);
	});

	it('resolves unbound imports to their target definition parameters', () => {
		const { unboundOperations } = parseMetadataXml(SYNTHETIC_EDMX_V4);
		const byName = new Map(unboundOperations.map((operation) => [operation.name, operation]));

		expect(byName.get('CompanyService_GetCompanyInfo')).toEqual({
			name: 'CompanyService_GetCompanyInfo',
			kind: 'function',
			parameters: [
				{ name: 'CompanyCode', edmType: 'Edm.String', literalKind: 'string', nullable: true },
			],
		});
		expect(byName.get('QueryService_PostQuery')?.kind).toBe('action');
	});

	it('tolerates an import whose target definition is missing', () => {
		const { unboundOperations } = parseMetadataXml(SYNTHETIC_EDMX_V4);
		const dangling = unboundOperations.find((operation) => operation.name === 'DanglingImport');

		expect(dangling?.parameters).toEqual([]);
	});

	it('does not mistake FunctionImport/ActionImport for bare definitions', () => {
		const names = parseMetadataXml(SYNTHETIC_EDMX_V4).unboundOperations.map((o) => o.name);

		expect(names).toEqual([...new Set(names)]);
		expect(names).toHaveLength(3);
	});

	it('rejects an entity set that references an undeclared entity type', () => {
		expect(() => parseMetadataXml(EDMX_BROKEN_ENTITY_SET)).toThrow(
			/references an entity type that was not found/,
		);
	});

	it('parses an empty document into an empty model rather than failing', () => {
		const metadata = parseMetadataXml(EDMX_EMPTY);

		expect(metadata.entities.size).toBe(0);
		expect(metadata.unboundOperations).toEqual([]);
		expect(metadata.complexTypes.size).toBe(0);
		expect(metadata.enumTypes.size).toBe(0);
		expect(metadata.entityTypes.size).toBe(0);
	});
});

describe('parseMetadataXml complex and enum types', () => {
	const metadata = parseMetadataXml(EDMX_COMPLEX_AND_ENUM_TYPES);

	it('splices the declarations into the base fixture', () => {
		expect(EDMX_COMPLEX_AND_ENUM_TYPES).not.toBe(SYNTHETIC_EDMX_V4);
	});

	it('parses complex type properties with type and nullability', () => {
		expect(metadata.complexTypes.get('DocumentLine')).toEqual({
			name: 'DocumentLine',
			properties: [
				{ name: 'ItemCode', edmType: 'Edm.String', nullable: true },
				{ name: 'LineNum', edmType: 'Edm.Int32', nullable: false },
				{ name: 'Quantity', edmType: 'Edm.Double', nullable: true },
				{ name: 'TaxOnly', edmType: 'SAPB1.BoYesNoEnum', nullable: true },
				{ name: 'Address', edmType: 'SAPB1.AddressExtension', nullable: true },
				{
					name: 'LineTaxJurisdictions',
					edmType: 'Collection(SAPB1.LineTaxJurisdiction)',
					nullable: true,
				},
			],
		});
	});

	it('reads attributes regardless of their order', () => {
		expect(metadata.complexTypes.get('AddressExtension')?.properties).toEqual([
			{ name: 'ShipToStreet', edmType: 'Edm.String', nullable: true },
			{ name: 'BillToCity', edmType: 'Edm.String', nullable: false },
		]);
		expect(metadata.complexTypes.has('LineTaxJurisdiction')).toBe(true);
		expect(metadata.enumTypes.get('BoStatus')?.members).toEqual([
			{ name: 'bost_Close', value: '1' },
			{ name: 'bost_Open', value: '0' },
		]);
	});

	it('gives a self-closing complex type an empty property list', () => {
		expect(metadata.complexTypes.get('DocumentDistributedExpense')).toEqual({
			name: 'DocumentDistributedExpense',
			properties: [],
		});
	});

	it('keeps the first declaration of a complex type declared twice', () => {
		expect(metadata.complexTypes.get('Event')?.properties.map((p) => p.name)).toEqual([
			'WebhookID',
		]);
	});

	it('collects every enum type once, in declaration order', () => {
		expect([...metadata.enumTypes.keys()]).toEqual([
			'BoYesNoEnum',
			'BoStatus',
			'BoPermissionFlags',
			'EmptyEnum',
		]);
	});

	it('parses enum members with their values, in declaration order', () => {
		expect(metadata.enumTypes.get('BoYesNoEnum')).toEqual({
			name: 'BoYesNoEnum',
			isFlags: false,
			members: [
				{ name: 'tNO', value: '0' },
				{ name: 'tYES', value: '1' },
			],
		});
	});

	it('keeps the first declaration of an enum type declared twice', () => {
		expect(metadata.enumTypes.get('BoStatus')?.members.map((m) => m.name)).toEqual([
			'bost_Close',
			'bost_Open',
		]);
	});

	it('marks a flags enum', () => {
		expect(metadata.enumTypes.get('BoPermissionFlags')?.isFlags).toBe(true);
	});

	it('gives a self-closing enum type an empty member list', () => {
		expect(metadata.enumTypes.get('EmptyEnum')).toEqual({
			name: 'EmptyEnum',
			isFlags: false,
			members: [],
		});
	});

	it('collects every entity type, including ones no entity set exposes', () => {
		expect([...metadata.entityTypes.keys()]).toEqual([
			'Order',
			'SalesTaxAuthority',
			'Item',
			'Ghost',
			'Report',
		]);
		expect(metadata.entityTypes.get('Order')).toEqual({
			name: 'Order',
			properties: metadata.entities.get('Orders')?.properties,
		});
	});

	it('leaves the entity and operation output unchanged', () => {
		const base = parseMetadataXml(SYNTHETIC_EDMX_V4);

		expect(metadata.entities).toEqual(base.entities);
		expect(metadata.unboundOperations).toEqual(base.unboundOperations);
	});
});

describe('getServiceLayerMetadata', () => {
	function scenario(metadataXml: string) {
		const http = createHttpFake({
			'POST /Login': LOGIN_OK,
			'GET /$metadata': { statusCode: 200, body: metadataXml },
		});
		const { credentials, credentialId } = createTestCredentials();

		return {
			http,
			credentials,
			credentialId,
			load: async () =>
				await getServiceLayerMetadata.call(createRequestContext(http), credentials, credentialId),
		};
	}

	it('fetches the metadata document through the authenticated request layer', async () => {
		const test = scenario(SYNTHETIC_EDMX_V4);

		const metadata = await test.load();

		expect(metadata.entities.has('Orders')).toBe(true);
		expect(test.http.callsFor('GET /$metadata')[0]).toMatchObject({
			url: '/$metadata',
			method: 'GET',
			json: false,
		});
	});

	it('serves a repeat call from the cache', async () => {
		const test = scenario(SYNTHETIC_EDMX_V4);

		const first = await test.load();
		const second = await test.load();

		expect(second).toBe(first);
		expect(test.http.countFor('GET /$metadata')).toBe(1);
	});

	it('shares one cached copy across credentials for the same instance and company', async () => {
		const test = scenario(SYNTHETIC_EDMX_V4);
		const otherUser = { ...test.credentials, username: 'other', password: 'other' };

		await test.load();
		await getServiceLayerMetadata.call(createRequestContext(test.http), otherUser, 'cred-other');

		expect(test.http.countFor('GET /$metadata')).toBe(1);
	});

	it('collapses concurrent loads onto a single fetch', async () => {
		const deferred = createDeferred<FakeResponse>();
		const http = createHttpFake({
			'POST /Login': LOGIN_OK,
			'GET /$metadata': async () => await deferred.promise,
		});
		const { credentials, credentialId } = createTestCredentials();
		const context = createRequestContext(http);

		const flights = [1, 2, 3, 4].map(
			async () => await getServiceLayerMetadata.call(context, credentials, credentialId),
		);

		deferred.resolve({ statusCode: 200, body: SYNTHETIC_EDMX_V4 });
		const results = await Promise.all(flights);

		expect(http.countFor('GET /$metadata')).toBe(1);
		expect(results.every((result) => result === results[0])).toBe(true);
	});

	it('rejects the older Service Layer v1 metadata format', async () => {
		const error = await scenario(EDMX_V1)
			.load()
			.catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(NodeOperationError);

		const text = flattenErrorText(error);
		expect(text).toContain('Unsupported Service Layer metadata version');
		expect(text).toContain('1.0');
	});

	it('reports an unknown version when the root carries none', async () => {
		const error = await scenario(EDMX_NO_VERSION)
			.load()
			.catch((caught: unknown) => caught);

		expect(flattenErrorText(error)).toContain('unknown');
	});

	it('reports a parse failure without echoing the document or the parser error', async () => {
		const error = await scenario(EDMX_BROKEN_ENTITY_SET)
			.load()
			.catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(NodeOperationError);

		const text = flattenErrorText(error);
		expect(text).toContain('Could not parse Service Layer metadata');
		expect(text).not.toContain('<EntitySet');
		expect(text).not.toContain('references an entity type');
	});
});
