import { afterEach, describe, expect, it, vi } from 'vitest';

import { settleBackgroundChecks } from '../nodes/SapBusinessOneServiceLayer/helpers/backgroundCheck';
import {
	compareLabels,
	formatLabel,
	getEntitySetLabels,
	getPropertyLabels,
	parseEntitySetLabels,
	parsePropertyLabels,
} from '../nodes/SapBusinessOneServiceLayer/helpers/labels';
import {
	ENTITY_SET_LABELS_ANNOTATED,
	ENTITY_SET_LABELS_ATTRIBUTE,
	ORDER_PROPERTY_LABELS_ANNOTATED,
	ORDER_PROPERTY_LABELS_ATTRIBUTE,
	SYNTHETIC_EDMX_V4,
} from './fixtures/metadataDocuments';
import { createTestCredentials } from './helpers/credentials';
import { createDeferred, createHttpFake, type FakeResponse, type RouteTable } from './helpers/http';
import { createRequestContext, createTestNode } from './helpers/node';

const LOGIN_OK: FakeResponse = {
	statusCode: 200,
	body: { SessionId: 'sess-1', SessionTimeout: 30 },
};

const ENTITY_SET_LABELS_ROUTE = 'GET /$metadata?scope=entityset&annotation=label';
const ORDER_LABELS_ROUTE = 'GET /$metadata?scope=entityset&entityset=Orders&annotation=label';

function scenario(routes: RouteTable) {
	const http = createHttpFake({ 'POST /Login': LOGIN_OK, ...routes });
	const { credentials, credentialId } = createTestCredentials();
	const context = createRequestContext(http, createTestNode(credentialId));

	return {
		http,
		entitySetLabels: async () => await getEntitySetLabels.call(context, credentials, credentialId),
		propertyLabels: async (entitySetName: string) =>
			await getPropertyLabels.call(context, credentials, credentialId, entitySetName),
	};
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('parseEntitySetLabels', () => {
	it.each([
		['a Common.Label annotation (FP2608 and later)', ENTITY_SET_LABELS_ANNOTATED],
		['an sap:label attribute (older versions)', ENTITY_SET_LABELS_ATTRIBUTE],
	])('reads %s', (_format, xml) => {
		expect(Object.fromEntries(parseEntitySetLabels(xml))).toEqual({
			Orders: 'Sales Order',
			Items: 'Items',
			// Never split at the colon: a real label reads "Object: HR Employee Transfer".
			Reports: 'Object: Berichte & Auswertungen für Verkäufe',
		});
	});

	it('ignores entity sets outside the entity container', () => {
		expect(parseEntitySetLabels(ENTITY_SET_LABELS_ANNOTATED).has('OutsideContainer')).toBe(false);
	});

	it('reads no labels from a document without any', () => {
		expect(parseEntitySetLabels(SYNTHETIC_EDMX_V4).size).toBe(0);
	});

	it('reads no labels from text that is not a metadata document', () => {
		expect(parseEntitySetLabels('<html><body>Service unavailable</body></html>').size).toBe(0);
		expect(parseEntitySetLabels('').size).toBe(0);
	});

	it('prefers the annotation when an entity set carries both formats', () => {
		const xml = `<EntityContainer Name="SAPB1">
			<EntitySet Name="Orders" sap:label="Old Wording" EntityType="SAPB1.Order">
				<Annotation Term="Common.Label" String="New Wording"/>
			</EntitySet>
		</EntityContainer>`;

		expect(parseEntitySetLabels(xml).get('Orders')).toBe('New Wording');
	});

	it('keeps a > inside a quoted attribute value', () => {
		const xml = `<EntityContainer Name="SAPB1">
			<EntitySet EntityType="SAPB1.Order" Name="Orders" sap:label="Orders > 1000"/>
		</EntityContainer>`;

		expect(parseEntitySetLabels(xml).get('Orders')).toBe('Orders > 1000');
	});
});

describe('parsePropertyLabels', () => {
	it('reads Common.Label annotations (FP2608 and later)', () => {
		expect(Object.fromEntries(parsePropertyLabels(ORDER_PROPERTY_LABELS_ANNOTATED))).toEqual({
			CardCode: 'Customer/Vendor Code',
			DocEntry: 'Internal Number',
			DocumentLines: 'Sales Order - Rows',
		});
	});

	it('reads sap:label attributes and never splits them at a colon', () => {
		expect(Object.fromEntries(parsePropertyLabels(ORDER_PROPERTY_LABELS_ATTRIBUTE))).toEqual({
			CardCode: 'Customer/Vendor Code',
			DocEntry: 'Object: Internal Number',
			DocTotal: 'Total: incl. Tax',
		});
	});

	it('reads no labels from the plain metadata document', () => {
		expect(parsePropertyLabels(SYNTHETIC_EDMX_V4).size).toBe(0);
	});
});

describe('formatLabel', () => {
	const labels = new Map([
		['BusinessPartners', 'Business Partners'],
		['Items', 'Items'],
		['Warehouses', 'warehouses'],
	]);

	it('shows the label followed by the technical name', () => {
		expect(formatLabel('BusinessPartners', labels)).toBe('Business Partners (BusinessPartners)');
	});

	it('shows only the technical name when the label is exactly the same', () => {
		expect(formatLabel('Items', labels)).toBe('Items');
	});

	it('shows both when the label differs only in case', () => {
		expect(formatLabel('Warehouses', labels)).toBe('warehouses (Warehouses)');
	});

	it('falls back to the technical name when there is no label', () => {
		expect(formatLabel('Orders', labels)).toBe('Orders');
	});
});

describe('compareLabels', () => {
	it('sorts alphabetically, puts texts that do not start with a letter last and compares numbers as numbers', () => {
		const texts = [
			'1099 Box (Box1099)',
			'Zone 10 (Tags)',
			'#740 (Messages)',
			'347 Operation Code (OperationCode347)',
			'business Partners (BusinessPartners)',
			'Änderungsprotokoll (ChangeLogs)',
			'Zone 9 (Mystery)',
			'Account Balance (CurrentAccountBalance)',
		];

		expect([...texts].sort(compareLabels)).toEqual([
			'Account Balance (CurrentAccountBalance)',
			// A letter with an accent is a letter: sorted with A, not moved to the end.
			'Änderungsprotokoll (ChangeLogs)',
			'business Partners (BusinessPartners)',
			'Zone 9 (Mystery)',
			'Zone 10 (Tags)',
			'#740 (Messages)',
			'347 Operation Code (OperationCode347)',
			'1099 Box (Box1099)',
		]);
	});
});

describe('getEntitySetLabels', () => {
	it('requests the entity container with labels as text and parses it', async () => {
		const test = scenario({
			[ENTITY_SET_LABELS_ROUTE]: { statusCode: 200, body: ENTITY_SET_LABELS_ANNOTATED },
		});

		const labels = await test.entitySetLabels();

		expect(labels.get('Orders')).toBe('Sales Order');
		const [request] = test.http.callsFor(ENTITY_SET_LABELS_ROUTE);
		expect(request.json).toBe(false);
		expect(request.headers?.Cookie).toBe('B1SESSION=sess-1');
	});

	it('fetches once and serves repeated calls from the cache', async () => {
		const test = scenario({
			[ENTITY_SET_LABELS_ROUTE]: { statusCode: 200, body: ENTITY_SET_LABELS_ANNOTATED },
		});

		await test.entitySetLabels();
		await test.entitySetLabels();

		expect(test.http.countFor(ENTITY_SET_LABELS_ROUTE)).toBe(1);
		expect(test.http.countFor('POST /Login')).toBe(1);
	});

	it('shares one request between concurrent calls', async () => {
		const response = createDeferred<FakeResponse>();
		const test = scenario({ [ENTITY_SET_LABELS_ROUTE]: async () => await response.promise });

		const first = test.entitySetLabels();
		const second = test.entitySetLabels();
		response.resolve({ statusCode: 200, body: ENTITY_SET_LABELS_ANNOTATED });

		const [a, b] = await Promise.all([first, second]);

		expect(a).toBe(b);
		expect(test.http.countFor(ENTITY_SET_LABELS_ROUTE)).toBe(1);
	});

	it('answers from the cache after an hour too, and checks once in the background', async () => {
		const test = scenario({
			[ENTITY_SET_LABELS_ROUTE]: { statusCode: 200, body: ENTITY_SET_LABELS_ANNOTATED },
		});
		const start = Date.now();
		const now = vi.spyOn(Date, 'now').mockReturnValue(start);

		const first = await test.entitySetLabels();
		now.mockReturnValue(start + 60 * 60 * 1000 + 1);
		const later = await test.entitySetLabels();
		await test.entitySetLabels();
		await settleBackgroundChecks();

		expect(later).toBe(first);
		expect(test.http.countFor(ENTITY_SET_LABELS_ROUTE)).toBe(2);
	});

	it('keeps the labels of two companies apart', async () => {
		const first = scenario({
			[ENTITY_SET_LABELS_ROUTE]: { statusCode: 200, body: ENTITY_SET_LABELS_ANNOTATED },
		});
		const second = scenario({ [ENTITY_SET_LABELS_ROUTE]: { statusCode: 200, body: '' } });

		await first.entitySetLabels();
		const labels = await second.entitySetLabels();

		expect(labels.size).toBe(0);
		expect(second.http.countFor(ENTITY_SET_LABELS_ROUTE)).toBe(1);
	});

	it('caches an answer without labels, so the server is not asked again', async () => {
		const test = scenario({
			[ENTITY_SET_LABELS_ROUTE]: { statusCode: 200, body: '<html></html>' },
		});

		await expect(test.entitySetLabels()).resolves.toEqual(new Map());
		await test.entitySetLabels();

		expect(test.http.countFor(ENTITY_SET_LABELS_ROUTE)).toBe(1);
	});

	it.each([
		['the server rejects the request', { statusCode: 400, body: { error: { code: -1 } } }],
		['the server fails', { statusCode: 500, body: { error: { code: -1 } } }],
		['the answer is not text', { statusCode: 200, body: { value: [] } }],
		['the Service Layer cannot be reached', { rejectWith: new Error('connect ECONNREFUSED') }],
	])('returns no labels, and asks again next time, when %s', async (_case, response) => {
		const test = scenario({ [ENTITY_SET_LABELS_ROUTE]: response });

		await expect(test.entitySetLabels()).resolves.toEqual(new Map());
		await expect(test.entitySetLabels()).resolves.toEqual(new Map());

		expect(test.http.countFor(ENTITY_SET_LABELS_ROUTE)).toBe(2);
	});

	it('returns no labels when the login is rejected', async () => {
		const test = scenario({
			'POST /Login': { statusCode: 401, body: { error: { code: -304 } } },
		});

		await expect(test.entitySetLabels()).resolves.toEqual(new Map());
	});

	it('loads the labels once the login works again, instead of an hour later', async () => {
		const failingLogin: FakeResponse = { statusCode: 401, body: { error: { code: -304 } } };
		let login = failingLogin;
		const test = scenario({
			'POST /Login': async () => await Promise.resolve(login),
			[ENTITY_SET_LABELS_ROUTE]: { statusCode: 200, body: ENTITY_SET_LABELS_ANNOTATED },
		});

		await expect(test.entitySetLabels()).resolves.toEqual(new Map());
		login = LOGIN_OK;
		const labels = await test.entitySetLabels();

		expect(labels.get('Orders')).toBe('Sales Order');
	});
});

describe('getPropertyLabels', () => {
	it("requests the labels of one entity set's properties and parses them", async () => {
		const test = scenario({
			[ORDER_LABELS_ROUTE]: { statusCode: 200, body: ORDER_PROPERTY_LABELS_ATTRIBUTE },
		});

		const labels = await test.propertyLabels('Orders');

		expect(labels.get('CardCode')).toBe('Customer/Vendor Code');
		expect(test.http.callsFor(ORDER_LABELS_ROUTE)[0].json).toBe(false);
	});

	it('caches each entity set on its own', async () => {
		const test = scenario({
			[ORDER_LABELS_ROUTE]: { statusCode: 200, body: ORDER_PROPERTY_LABELS_ANNOTATED },
			'GET /$metadata?scope=entityset&entityset=Items&annotation=label': {
				statusCode: 200,
				body: '',
			},
		});

		await test.propertyLabels('Orders');
		await test.propertyLabels('Items');
		await test.propertyLabels('Orders');

		expect(test.http.countFor(ORDER_LABELS_ROUTE)).toBe(1);
		expect(
			test.http.countFor('GET /$metadata?scope=entityset&entityset=Items&annotation=label'),
		).toBe(1);
	});

	it('keeps entity set labels and property labels apart', async () => {
		const test = scenario({
			[ENTITY_SET_LABELS_ROUTE]: { statusCode: 200, body: ENTITY_SET_LABELS_ANNOTATED },
			[ORDER_LABELS_ROUTE]: { statusCode: 200, body: ORDER_PROPERTY_LABELS_ANNOTATED },
		});

		const entitySets = await test.entitySetLabels();
		const properties = await test.propertyLabels('Orders');

		expect(entitySets.has('CardCode')).toBe(false);
		expect(properties.has('Orders')).toBe(false);
	});

	it('encodes the entity set name in the request', async () => {
		const route = 'GET /$metadata?scope=entityset&entityset=U_MY%20TABLE&annotation=label';
		const test = scenario({ [route]: { statusCode: 200, body: '' } });

		await test.propertyLabels('U_MY TABLE');

		expect(test.http.countFor(route)).toBe(1);
	});
});
