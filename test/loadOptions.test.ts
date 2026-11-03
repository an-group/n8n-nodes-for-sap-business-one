import { describe, expect, it } from 'vitest';

import {
	getFilterEnumValues,
	getFilterableFields,
	getSelectableFields,
	getSortableFields,
} from '../nodes/SapBusinessOneServiceLayer/methods/loadOptions';
import {
	EDMX_FILTERABLE_PROPERTIES,
	EDMX_STRUCTURED_PROPERTIES,
	ORDER_PROPERTY_LABELS_ANNOTATED,
	SYNTHETIC_EDMX_V4,
} from './fixtures/metadataDocuments';
import { createTestCredentials } from './helpers/credentials';
import { createHttpFake, type FakeResponse, type RouteTable } from './helpers/http';
import { createLoadOptionsFunctions, createTestNode } from './helpers/node';

const LOGIN_OK: FakeResponse = {
	statusCode: 200,
	body: { SessionId: 'sess-1', SessionTimeout: 30 },
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

async function fieldsFor(
	method: typeof getSelectableFields | typeof getSortableFields | typeof getFilterableFields,
	entitySet: string | undefined,
) {
	const { context, http } = scenario({
		metadataXml: EDMX_STRUCTURED_PROPERTIES,
		parameters: { entitySet },
	});

	return { values: (await method.call(context)).map((option) => option.value), http };
}

describe('getSelectableFields', () => {
	it('lists every property sorted by name, collections and complex properties included', async () => {
		const { values } = await fieldsFor(getSelectableFields, 'Orders');

		expect(values).toEqual([
			'AddressExtension',
			'Approver',
			'CardCode',
			'DocEntry',
			'DocTime',
			'DocumentLines',
			'DocumentStatus',
			'Mystery',
			'Permissions',
			'Placeholder',
			'Tags',
		]);
	});

	it('labels each option with the property name', async () => {
		const { context } = scenario({
			metadataXml: EDMX_STRUCTURED_PROPERTIES,
			parameters: { entitySet: 'KeyOnlys' },
		});

		await expect(getSelectableFields.call(context)).resolves.toEqual([
			{ name: 'Code', value: 'Code' },
		]);
	});

	it('returns an empty list for an entity set the metadata does not describe', async () => {
		const { values } = await fieldsFor(getSelectableFields, 'NoSuchSet');

		expect(values).toEqual([]);
	});

	it('stays empty, and fetches nothing, while no entity set is selected', async () => {
		const { values, http } = await fieldsFor(getSelectableFields, '');

		expect(values).toEqual([]);
		expect(http.calls).toHaveLength(0);
	});
});

describe('getSortableFields', () => {
	it('lists only single primitive and enum properties', async () => {
		const { values } = await fieldsFor(getSortableFields, 'Orders');

		// Left out: the complex AddressExtension, the entity-typed Approver, the
		// collections DocumentLines and Tags, and the undeclared Mystery.
		expect(values).toEqual([
			'CardCode',
			'DocEntry',
			'DocTime',
			'DocumentStatus',
			'Permissions',
			'Placeholder',
		]);
	});

	it('returns an empty list for an entity set the metadata does not describe', async () => {
		const { values } = await fieldsFor(getSortableFields, 'NoSuchSet');

		expect(values).toEqual([]);
	});

	it('stays empty, and fetches nothing, while no entity set is selected', async () => {
		const { values, http } = await fieldsFor(getSortableFields, undefined);

		expect(values).toEqual([]);
		expect(http.calls).toHaveLength(0);
	});
});

describe('getFilterableFields', () => {
	it('lists the fields of Sort, each value carrying its value input and operator set', async () => {
		const { values } = await fieldsFor(getFilterableFields, 'Orders');

		expect(values).toEqual([
			'CardCode|text|text',
			'DocEntry|text|ordered',
			'DocTime|text|ordered',
			'DocumentStatus|enum|equality',
			// A flags enum and an enum without members keep a text input, but no
			// string functions: on an enum they silently match nothing.
			'Permissions|text|equality',
			'Placeholder|text|equality',
		]);
	});

	it('labels each option with the bare property name', async () => {
		const { context } = scenario({
			metadataXml: EDMX_STRUCTURED_PROPERTIES,
			parameters: { entitySet: 'Orders' },
		});
		const options = await getFilterableFields.call(context);

		expect(options).toContainEqual({ name: 'DocumentStatus', value: 'DocumentStatus|enum|equality' });
	});

	it('marks a date field for the date picker', async () => {
		const { context } = scenario({
			metadataXml: EDMX_FILTERABLE_PROPERTIES,
			parameters: { entitySet: 'Orders' },
		});
		const values = (await getFilterableFields.call(context)).map((option) => option.value);

		expect(values).toContain('DocDate|date|ordered');
		expect(values).toContain('DocTotal|text|ordered');
		expect(values).toContain('Printed|text|equality');
	});

	it('stays empty, and fetches nothing, while no entity set is selected', async () => {
		const { values, http } = await fieldsFor(getFilterableFields, '');

		expect(values).toEqual([]);
		expect(http.calls).toHaveLength(0);
	});
});

describe('getFilterEnumValues', () => {
	async function enumValuesFor(entitySet: string | undefined, field: unknown) {
		const { context, http } = scenario({
			metadataXml: EDMX_STRUCTURED_PROPERTIES,
			parameters: { entitySet, '&field': field },
		});

		return { options: await getFilterEnumValues.call(context), http };
	}

	it('lists the members of the enum field chosen in the same condition', async () => {
		const { options } = await enumValuesFor('Orders', 'DocumentStatus|enum');

		expect(options).toEqual([
			{ name: 'bost_Open', value: 'bost_Open' },
			{ name: 'bost_Close', value: 'bost_Close' },
		]);
	});

	it('accepts a field name without the kind, as an expression may give it', async () => {
		const { options } = await enumValuesFor('Orders', 'DocumentStatus');

		expect(options).toHaveLength(2);
	});

	it.each([
		['a field that is not an enum', 'CardCode|text'],
		['a flags enum', 'Permissions|text'],
		['an unknown field', 'NoSuchField|enum'],
		['no field yet', undefined],
	])('lists nothing for %s', async (_label, field) => {
		const { options } = await enumValuesFor('Orders', field);

		expect(options).toEqual([]);
	});

	it('stays empty, and fetches nothing, while no entity set is selected', async () => {
		const { options, http } = await enumValuesFor('', 'DocumentStatus|enum');

		expect(options).toEqual([]);
		expect(http.calls).toHaveLength(0);
	});
});

const ORDER_LABELS_ROUTE =
	'GET /$metadata?scope=entityset&entityset=Orders&annotation=label';

describe('field lists with SAP labels', () => {
	function labelled(parameters: Record<string, unknown>, labelsResponse?: FakeResponse) {
		return scenario({
			metadataXml: EDMX_FILTERABLE_PROPERTIES,
			parameters,
			routes: {
				[ORDER_LABELS_ROUTE]: labelsResponse ?? {
					statusCode: 200,
					body: ORDER_PROPERTY_LABELS_ANNOTATED,
				},
			},
		});
	}

	it('shows each field as "Label (Name)", sorted by that text, with the name as value', async () => {
		const { context } = labelled({ entitySet: 'Orders' });

		const options = await getSelectableFields.call(context);

		expect(options.slice(0, 3)).toEqual([
			{ name: 'AddressExtension', value: 'AddressExtension' },
			{ name: 'Approver', value: 'Approver' },
			{ name: 'Customer/Vendor Code (CardCode)', value: 'CardCode' },
		]);
		expect(options).toContainEqual({ name: 'Internal Number (DocEntry)', value: 'DocEntry' });
		expect(options).toContainEqual({
			name: 'Sales Order - Rows (DocumentLines)',
			value: 'DocumentLines',
		});
		// DocTotal has no label and keeps its name.
		expect(options).toContainEqual({ name: 'DocTotal', value: 'DocTotal' });
	});

	it('labels the Sort fields', async () => {
		const { context } = labelled({ entitySet: 'Orders' });

		const options = await getSortableFields.call(context);

		expect(options).toContainEqual({ name: 'Internal Number (DocEntry)', value: 'DocEntry' });
		expect(options.map((option) => option.value)).not.toContain('DocumentLines');
	});

	it('labels the filter fields and keeps the kind and operators in the value', async () => {
		const { context } = labelled({ entitySet: 'Orders' });

		const options = await getFilterableFields.call(context);

		expect(options).toContainEqual({
			name: 'Customer/Vendor Code (CardCode)',
			value: 'CardCode|text|text',
		});
		expect(options).toContainEqual({ name: 'DocDate', value: 'DocDate|date|ordered' });
	});

	it('requests the labels of the entity set once for every list', async () => {
		const { context, http } = labelled({ entitySet: 'Orders' });

		await getSelectableFields.call(context);
		await getSortableFields.call(context);
		await getFilterableFields.call(context);

		expect(http.countFor(ORDER_LABELS_ROUTE)).toBe(1);
		expect(http.countFor('GET /$metadata')).toBe(1);
	});

	it('falls back to the technical names when the server rejects the label request', async () => {
		const { context } = labelled(
			{ entitySet: 'Orders' },
			{ statusCode: 400, body: { error: { code: -1 } } },
		);

		const options = await getSelectableFields.call(context);

		expect(options.every((option) => option.name === option.value)).toBe(true);
	});

	it('requests no labels for the enum value dropdown', async () => {
		const { context, http } = labelled({ entitySet: 'Orders', '&field': 'DocumentStatus|enum' });

		await getFilterEnumValues.call(context);

		expect(http.countFor(ORDER_LABELS_ROUTE)).toBe(0);
	});
});
