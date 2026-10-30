import { NodeApiError, NodeOperationError } from 'n8n-workflow';
import type { ResourceMapperField } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { getEntitySets } from '../nodes/SapBusinessOneServiceLayer/methods/loadOptions';
import {
	getBoundOperationParameters,
	getEntityFields,
	getEntityKeys,
	getServiceOperationParameters,
} from '../nodes/SapBusinessOneServiceLayer/methods/resourceMapping';
import {
	EDMX_BOUND_OPERATIONS,
	EDMX_BROKEN_ENTITY_SET,
	EDMX_EXPANDED_PARAMETERS,
	EDMX_FIELD_TYPES,
	EDMX_SERVICE_OPERATIONS,
	EDMX_STRUCTURED_PROPERTIES,
	EDMX_V1,
	SYNTHETIC_EDMX_V4,
} from './fixtures/metadataDocuments';
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
	parameters?: Record<string, unknown>;
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
	const { context } = createLoadOptionsFunctions({
		http,
		credentials,
		parameters: options.parameters,
		node: createTestNode(credentialId),
	});

	return { http, credentials, context };
}

/** The exact shape `getEntityFields` emits for one mappable property. */
function bodyField(id: string, type: ResourceMapperField['type']): ResourceMapperField {
	return {
		id,
		displayName: id,
		type,
		required: false,
		defaultMatch: false,
		canBeUsedToMatch: false,
		display: true,
	};
}

/** `bodyField` for an enum property: a dropdown of its member names. */
function enumField(id: string, members: string[]): ResourceMapperField {
	return {
		...bodyField(id, 'options'),
		options: members.map((member) => ({ name: member, value: member })),
	};
}

/** `BoStatus` members in declaration order, as the fixtures declare them. */
const BO_STATUS_MEMBERS = ['bost_Open', 'bost_Close'];

/** The exact shape `getEntityKeys` emits for one key property. */
function keyField(id: string, type: ResourceMapperField['type']): ResourceMapperField {
	return {
		id,
		displayName: id,
		type,
		required: true,
		defaultMatch: true,
		canBeUsedToMatch: true,
		display: true,
	};
}

async function keysFor(entitySet: string, metadataXml?: string) {
	return await getEntityKeys.call(scenario({ parameters: { entitySet }, metadataXml }).context);
}

async function fieldsFor(entitySet: string, operation: string, metadataXml?: string) {
	return await getEntityFields.call(
		scenario({ parameters: { entitySet, operation }, metadataXml }).context,
	);
}

describe('getEntityKeys', () => {
	it('maps a simple key to one required, matchable field', async () => {
		await expect(keysFor('Orders')).resolves.toEqual({ fields: [keyField('DocEntry', 'number')] });
	});

	it('keeps the key mapping for a time-of-day key, unlike the body fields', async () => {
		// Key Fields are out of scope for the time field (#37); no real key uses
		// Edm.TimeOfDay. On create the same property is a body field.
		await expect(keysFor('TimeSlots', EDMX_FIELD_TYPES)).resolves.toEqual({
			fields: [keyField('Slot', 'dateTime')],
		});
		await expect(fieldsFor('TimeSlots', 'create', EDMX_FIELD_TYPES)).resolves.toEqual({
			fields: [bodyField('Slot', 'time')],
		});
	});

	it('maps a composite key in metadata declaration order', async () => {
		// The entity type declares its properties Rate, Type, Code — so this
		// order can only have come from the <Key> block.
		await expect(keysFor('SalesTaxAuthorities')).resolves.toEqual({
			fields: [keyField('Type', 'number'), keyField('Code', 'string')],
		});
	});

	it('maps a string key', async () => {
		await expect(keysFor('Items')).resolves.toEqual({ fields: [keyField('ItemCode', 'string')] });
	});

	it('explains itself when the entity type has no key block', async () => {
		await expect(keysFor('Reports')).resolves.toEqual({
			fields: [],
			emptyFieldsNotice: 'No key fields found for entity set "Reports".',
		});
	});

	it('explains itself when the key names a property the entity type never declares', async () => {
		await expect(keysFor('Ghosts')).resolves.toEqual({
			fields: [],
			emptyFieldsNotice: 'No key fields found for entity set "Ghosts".',
		});
	});

	it('stays empty, without a notice, while no entity set is selected', async () => {
		await expect(keysFor('')).resolves.toEqual({ fields: [] });

		// n8n can hand back `undefined` before the dropdown has been populated.
		const pending = scenario({ parameters: { entitySet: undefined } });

		await expect(getEntityKeys.call(pending.context)).resolves.toEqual({ fields: [] });
	});

	it('stays empty for an entity set the metadata does not describe', async () => {
		await expect(keysFor('NotThere')).resolves.toEqual({ fields: [] });
	});
});

describe('getEntityFields', () => {
	it('lists every property in declaration order, collections as array fields', async () => {
		// SYNTHETIC_EDMX_V4 never declares DocumentLine; a collection is an array
		// field whatever its element type resolves to.
		await expect(fieldsFor('Orders', 'create')).resolves.toEqual({
			fields: [
				bodyField('CardCode', 'string'),
				bodyField('DocEntry', 'number'),
				bodyField('DocTotal', 'number'),
				bodyField('DocumentLines', 'array'),
			],
		});
	});

	it('excludes the key from an update body', async () => {
		await expect(fieldsFor('Orders', 'update')).resolves.toEqual({
			fields: [
				bodyField('CardCode', 'string'),
				bodyField('DocTotal', 'number'),
				bodyField('DocumentLines', 'array'),
			],
		});
	});

	it('offers complex properties as object fields and collections as array fields', async () => {
		await expect(fieldsFor('Orders', 'update', EDMX_STRUCTURED_PROPERTIES)).resolves.toEqual({
			fields: [
				bodyField('CardCode', 'string'),
				enumField('DocumentStatus', BO_STATUS_MEMBERS),
				bodyField('DocTime', 'time'),
				bodyField('AddressExtension', 'object'),
				bodyField('DocumentLines', 'array'),
				bodyField('Approver', 'object'),
				bodyField('Tags', 'array'),
				// A type the metadata never declares falls back to the old behaviour.
				bodyField('Mystery', 'string'),
				// A flags value may combine members, and an enum without members has
				// nothing to offer: both keep a text field.
				bodyField('Permissions', 'string'),
				bodyField('Placeholder', 'string'),
			],
		});
	});

	it('offers the enum members as options whose value is the member name', async () => {
		const { fields } = await fieldsFor('Orders', 'create', EDMX_STRUCTURED_PROPERTIES);

		expect(fields.find((field) => field.id === 'DocumentStatus')?.options).toEqual([
			{ name: 'bost_Open', value: 'bost_Open' },
			{ name: 'bost_Close', value: 'bost_Close' },
		]);
	});

	it('excludes every part of a composite key from an update body', async () => {
		await expect(fieldsFor('SalesTaxAuthorities', 'update')).resolves.toEqual({
			fields: [bodyField('Rate', 'number')],
		});
	});

	it('keeps composite key parts available on create', async () => {
		// Some entity sets need a user-supplied key; metadata cannot tell which.
		await expect(fieldsFor('SalesTaxAuthorities', 'create')).resolves.toEqual({
			fields: [
				bodyField('Rate', 'number'),
				bodyField('Type', 'number'),
				bodyField('Code', 'string'),
			],
		});
	});

	it('treats only update as key-excluding', async () => {
		// The filter reads `operation !== 'update'`, so every other operation has
		// to behave like create. Writing this with create/update alone would pass
		// just as happily against an inclusion list.
		await expect(fieldsFor('Orders', 'get')).resolves.toEqual({
			fields: [
				bodyField('CardCode', 'string'),
				bodyField('DocEntry', 'number'),
				bodyField('DocTotal', 'number'),
				bodyField('DocumentLines', 'array'),
			],
		});
	});

	it('drops nothing from an update on a keyless entity', async () => {
		await expect(fieldsFor('Reports', 'update')).resolves.toEqual({
			fields: [bodyField('Title', 'string')],
		});
	});

	it('maps every EDM type the Service Layer declares to a mapper field type', async () => {
		await expect(fieldsFor('FieldTypes', 'create', EDMX_FIELD_TYPES)).resolves.toEqual({
			fields: [
				bodyField('Code', 'string'),
				bodyField('Count', 'number'),
				bodyField('Amount', 'number'),
				// Active and Ref are pinned as current behaviour, not endorsed as
				// correct: n8n has a 'boolean' field type (rendered as a toggle) and
				// a Guid is not a number. Both land on 'number' because
				// classifyEdmType exists to decide OData literal quoting, where
				// unquoted is right for them — that answer is simply not a widget
				// choice. Changing it is a behaviour change, out of scope here.
				bodyField('Active', 'number'),
				bodyField('Ref', 'number'),
				bodyField('DueDate', 'dateTime'),
				// This document never declares BoYesNoEnum, so there are no members
				// to offer.
				bodyField('Valid', 'string'),
				// A time of day gets n8n's time field, not the date picker.
				bodyField('StartTime', 'time'),
			],
		});
	});

	it('offers the collection of an entity that has nothing else', async () => {
		await expect(fieldsFor('LineContainers', 'create', EDMX_FIELD_TYPES)).resolves.toEqual({
			fields: [bodyField('Lines', 'array')],
		});
	});

	it('returns an empty list, and no notice, when every property is filtered out', async () => {
		await expect(fieldsFor('KeyOnlys', 'update', EDMX_STRUCTURED_PROPERTIES)).resolves.toEqual({
			fields: [],
		});

		// The two mappers differ here deliberately: the key mapper explains the
		// empty state, the body mapper leaves it bare.
		await expect(keysFor('LineContainers', EDMX_FIELD_TYPES)).resolves.toEqual({
			fields: [],
			emptyFieldsNotice: 'No key fields found for entity set "LineContainers".',
		});
	});

	it('never reads the operation before an entity set is selected', async () => {
		// `parameters` deliberately omits `operation`; the fake throws on an
		// unconfigured read, so this fails loudly if the lookup order changes.
		const pending = scenario({ parameters: { entitySet: '' } });

		await expect(getEntityFields.call(pending.context)).resolves.toEqual({ fields: [] });

		const unknown = scenario({ parameters: { entitySet: 'NotThere' } });

		await expect(getEntityFields.call(unknown.context)).resolves.toEqual({ fields: [] });
	});

	it('rejects metadata from the v1 API', async () => {
		await expect(fieldsFor('Orders', 'create', EDMX_V1)).rejects.toThrow(NodeOperationError);
	});

	it('surfaces unparseable metadata as a node operation error', async () => {
		await expect(fieldsFor('Orders', 'create', EDMX_BROKEN_ENTITY_SET)).rejects.toThrow(
			/Could not parse Service Layer metadata/,
		);
	});

	it('surfaces a rejected login as a node API error, without leaking', async () => {
		const { context, credentials } = scenario({
			parameters: { entitySet: 'Orders', operation: 'create' },
			routes: { 'POST /Login': LOGIN_REJECTED },
		});

		const caught = await getEntityFields.call(context).catch((error: unknown) => error);
		const text = flattenErrorText(caught);

		expect(caught).toBeInstanceOf(NodeApiError);
		// Proves the flattening found something, so the leak assertions below
		// cannot pass against an empty string.
		expect(text).toContain('Invalid company or user');
		expect(text).not.toContain(credentials.password);
		expect(text).not.toContain('B1SESSION');
		expect(text).not.toContain(credentials.baseUrl);
	});
});

describe('metadata reuse across the node methods', () => {
	it('shares one fetch between the option loader and both mappers', async () => {
		const { context, http } = scenario({
			parameters: { entitySet: 'Orders', operation: 'create' },
		});

		await getEntitySets.call(context);
		await getEntityKeys.call(context);
		await getEntityFields.call(context);

		// n8n re-runs these on every dropdown open and every loadOptionsDependsOn
		// change, so this cache is what keeps the editor off the Service Layer.
		expect(http.countFor('POST /Login')).toBe(1);
		expect(http.countFor('GET /$metadata')).toBe(1);
	});
});

async function parametersFor(serviceOperation: string | undefined) {
	const { context } = scenario({
		parameters: { serviceOperation },
		metadataXml: EDMX_SERVICE_OPERATIONS,
	});

	return await getServiceOperationParameters.call(context);
}

describe('getServiceOperationParameters', () => {
	it('maps simple parameters to optional fields of the matching type, in declaration order', async () => {
		await expect(parametersFor('SBOBobService_SetSystemPermission')).resolves.toEqual({
			fields: [
				bodyField('UserCode', 'string'),
				bodyField('PermissionID', 'string'),
				bodyField('Permission', 'number'),
			],
		});
	});

	it('maps a parameter of a type the metadata does not declare to an object field', async () => {
		await expect(parametersFor('BankStatementsService_GetBankStatementList')).resolves.toEqual({
			fields: [bodyField('BankStatementParams', 'object')],
		});
	});

	it('maps a collection parameter to an array field', async () => {
		await expect(parametersFor('BatchService_PostLines')).resolves.toEqual({
			fields: [bodyField('Lines', 'array')],
		});
	});

	it('explains itself when the operation takes no parameters', async () => {
		await expect(parametersFor('CleanupService_Run')).resolves.toEqual({
			fields: [],
			emptyFieldsNotice: '"CleanupService_Run" takes no parameters.',
		});
	});

	it('explains itself when the operation is not in the metadata', async () => {
		await expect(parametersFor('NoSuchService_Run')).resolves.toEqual({
			fields: [],
			emptyFieldsNotice: 'Unknown service operation "NoSuchService_Run".',
		});
	});

	it('stays empty, and fetches nothing, while no operation is selected', async () => {
		const { context, http } = scenario({ parameters: { serviceOperation: '' } });

		await expect(getServiceOperationParameters.call(context)).resolves.toEqual({ fields: [] });
		expect(http.calls).toHaveLength(0);
	});
});

async function expandedParametersFor(serviceOperation: string) {
	const { context } = scenario({
		parameters: { serviceOperation },
		metadataXml: EDMX_EXPANDED_PARAMETERS,
	});

	return await getServiceOperationParameters.call(context);
}

describe('getServiceOperationParameters: a single complex or entity parameter', () => {
	const BANK_STATEMENT_FIELDS = [
		bodyField('BankAccountKey', 'number'),
		bodyField('StatementDate', 'dateTime'),
		bodyField('StatementTime', 'time'),
		enumField('Status', BO_STATUS_MEMBERS),
		bodyField('Address', 'object'),
		bodyField('Lines', 'array'),
	];

	it("expands a complex parameter into its type's properties, nested ones as JSON fields", async () => {
		await expect(
			expandedParametersFor('BankStatementsService_GetBankStatementList'),
		).resolves.toEqual({ fields: BANK_STATEMENT_FIELDS });
	});

	it("expands an entity-type parameter into the entity type's properties, without an entity set", async () => {
		await expect(expandedParametersFor('DocumentsService_Preview')).resolves.toEqual({
			fields: [bodyField('DocEntry', 'number'), bodyField('CardCode', 'string')],
		});
	});

	it('keeps one JSON field per parameter for several complex parameters', async () => {
		await expect(expandedParametersFor('MergeService_Merge')).resolves.toEqual({
			fields: [bodyField('Source', 'object'), bodyField('Target', 'object')],
		});
	});

	it('keeps a collection parameter as one array field', async () => {
		await expect(expandedParametersFor('BatchService_PostLines')).resolves.toEqual({
			fields: [bodyField('Lines', 'array')],
		});
	});

	it('keeps a complex type without properties as one object field', async () => {
		await expect(expandedParametersFor('EmptyService_Run')).resolves.toEqual({
			fields: [bodyField('Params', 'object')],
		});
	});

	it('maps an enum parameter to a dropdown and a time-of-day parameter to a time field', async () => {
		await expect(expandedParametersFor('StatusService_SetStatus')).resolves.toEqual({
			fields: [
				bodyField('Code', 'string'),
				enumField('Status', BO_STATUS_MEMBERS),
				bodyField('EffectiveAt', 'time'),
			],
		});
	});

	it('expands the parameter of a bound action the same way', async () => {
		const { context } = scenario({
			parameters: { entitySet: 'BankPages', boundOperation: 'Reconcile' },
			metadataXml: EDMX_EXPANDED_PARAMETERS,
		});

		await expect(getBoundOperationParameters.call(context)).resolves.toEqual({
			fields: BANK_STATEMENT_FIELDS,
		});
	});
});

async function boundParametersFor(entitySet: string | undefined, boundOperation?: string) {
	const { context, http } = scenario({
		parameters: { entitySet, boundOperation },
		metadataXml: EDMX_BOUND_OPERATIONS,
	});

	return { result: await getBoundOperationParameters.call(context), http };
}

describe('getBoundOperationParameters', () => {
	it('maps every parameter except the binding one, in declaration order', async () => {
		const { result } = await boundParametersFor('Orders', 'GetStatus');

		expect(result).toEqual({
			fields: [
				bodyField('Depth', 'number'),
				bodyField('Label', 'string'),
				bodyField('Filter', 'object'),
			],
		});
	});

	it("maps List's ParamList to a string field", async () => {
		const { result } = await boundParametersFor('SQLQueries', 'List');

		expect(result).toEqual({ fields: [bodyField('ParamList', 'string')] });
	});

	it('explains itself when the operation takes no parameters', async () => {
		const { result } = await boundParametersFor('StockTransfers', 'Close');

		expect(result).toEqual({ fields: [], emptyFieldsNotice: '"Close" takes no parameters.' });
	});

	it('explains itself when the operation is not bound to the entity set', async () => {
		const { result } = await boundParametersFor('StockTransfers', 'Reopen');

		expect(result).toEqual({
			fields: [],
			emptyFieldsNotice: 'Unknown action or function "Reopen" for entity set "StockTransfers".',
		});
	});

	it('stays empty, and fetches nothing, while no entity set is selected', async () => {
		const { result, http } = await boundParametersFor('', 'Close');

		expect(result).toEqual({ fields: [] });
		expect(http.calls).toHaveLength(0);
	});

	it('stays empty while no operation is selected', async () => {
		const { result } = await boundParametersFor('Orders', '');

		expect(result).toEqual({ fields: [] });
	});
});
