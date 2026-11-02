import { NodeOperationError } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import {
	buildFilterExpression,
	getConditionOperatorSet,
	getConditionValueKind,
	getEnumMemberNames,
	type FilterInput,
} from '../nodes/SapBusinessOneServiceLayer/helpers/filterExpression';
import { parseMetadataXml } from '../nodes/SapBusinessOneServiceLayer/helpers/metadata';
import { EDMX_FILTERABLE_PROPERTIES } from './fixtures/metadataDocuments';
import { flattenErrorText } from './helpers/errors';
import { createTestNode } from './helpers/node';

const metadata = parseMetadataXml(EDMX_FILTERABLE_PROPERTIES);
const orders = metadata.entities.get('Orders') ?? expect.unreachable('Orders is declared');
const context = { getNode: () => createTestNode() };

function build(input: Partial<FilterInput>): string {
	return buildFilterExpression(context, orders, metadata, {
		filterType: 'manual',
		...input,
	});
}

function conditions(...rows: Array<Record<string, unknown>>): unknown {
	return { condition: rows };
}

function condition(field: string, operator: string, value?: unknown): string {
	return build({ conditions: conditions({ field, operator, value }) });
}

function equal(field: string, value: unknown): string {
	return condition(field, 'equal', value);
}

function failure(run: () => unknown): string {
	try {
		run();
	} catch (error) {
		expect(error).toBeInstanceOf(NodeOperationError);

		return flattenErrorText(error);
	}

	throw new Error('expected the filter to be rejected');
}

describe('buildFilterExpression: nothing set', () => {
	it('returns an empty string', () => {
		expect(build({})).toBe('');
	});

	it('ignores an empty conditions list and a blank OData string', () => {
		expect(build({ conditions: {} })).toBe('');
		expect(build({ conditions: { condition: 'oops' } })).toBe('');
		expect(build({ filterType: 'string', filterString: '   ' })).toBe('');
	});
});

describe('buildFilterExpression: quoting by property type', () => {
	it('quotes a string, also when it looks like a number', () => {
		expect(equal('CardCode', '10001')).toBe("CardCode eq '10001'");
	});

	it('doubles an embedded quote and does not URL-encode', () => {
		expect(equal('CardCode', "O'Brien & Co #1")).toBe("CardCode eq 'O''Brien & Co #1'");
	});

	it('keeps the spaces of a string value', () => {
		expect(equal('CardCode', ' C1 ')).toBe("CardCode eq ' C1 '");
	});

	it('quotes an enum member', () => {
		expect(equal('DocumentStatus', 'bost_Open')).toBe("DocumentStatus eq 'bost_Open'");
	});

	it('quotes a flags enum member like any string', () => {
		expect(equal('Permissions', 'pfRead')).toBe("Permissions eq 'pfRead'");
	});

	it('writes numbers bare', () => {
		expect(equal('DocTotal', 1000)).toBe('DocTotal eq 1000');
		expect(equal('DocEntry', '45')).toBe('DocEntry eq 45');
		expect(condition('DocTotal', 'greaterThan', ' -12.50 ')).toBe('DocTotal gt -12.50');
	});

	it.each([
		['1.5e3', '1500'],
		['+5', '5'],
		['.5', '0.5'],
		[1e21, '1000000000000000000000'],
		[1e-7, '0.0000001'],
	])('never writes %s in exponent form', (raw, expected) => {
		expect(condition('DocTotal', 'equal', raw)).toBe(`DocTotal eq ${expected}`);
	});

	it('quotes a date and a time', () => {
		expect(equal('DocDate', '2026-02-25')).toBe("DocDate eq '2026-02-25'");
		expect(condition('DocDate', 'greaterOrEqual', ' 2026-02-25T00:00:00.000+01:00 ')).toBe(
			"DocDate ge '2026-02-25T00:00:00.000+01:00'",
		);
		expect(equal('DocTime', '08:00:00')).toBe("DocTime eq '08:00:00'");
	});

	it('writes a date picked in the editor (a Luxon DateTime) as ISO 8601', () => {
		const picked = { toISO: () => '2026-02-25T00:00:00.000+01:00' };

		expect(equal('DocDate', picked)).toBe("DocDate eq '2026-02-25T00:00:00.000+01:00'");
	});

	it('writes a JS Date as ISO 8601', () => {
		expect(equal('DocDate', new Date(Date.UTC(2026, 1, 25)))).toBe(
			"DocDate eq '2026-02-25T00:00:00.000Z'",
		);
	});

	it('writes a boolean bare', () => {
		expect(equal('Printed', true)).toBe('Printed eq true');
		expect(condition('Printed', 'notEqual', ' FALSE ')).toBe('Printed ne false');
	});
});

describe('buildFilterExpression: the value inputs of a condition', () => {
	it('reads the field name before the kind the dropdown appends', () => {
		expect(condition('CardCode|text', 'equal', 'C1')).toBe("CardCode eq 'C1'");
	});

	it('takes an enum value from the member dropdown', () => {
		const rows = conditions({
			field: 'DocumentStatus|enum',
			operator: 'equal',
			enumValue: 'bost_Open',
			value: 'stale',
		});

		expect(build({ conditions: rows })).toBe("DocumentStatus eq 'bost_Open'");
	});

	it('takes a date from the date picker', () => {
		const rows = conditions({
			field: 'DocDate|date',
			operator: 'greaterOrEqual',
			dateValue: '2026-01-01T00:00:00',
		});

		expect(build({ conditions: rows })).toBe("DocDate ge '2026-01-01T00:00:00'");
	});

	it('falls back to the text value, e.g. one set by expression', () => {
		const rows = conditions({ field: 'DocumentStatus', operator: 'equal', value: 'bost_Close' });

		expect(build({ conditions: rows })).toBe("DocumentStatus eq 'bost_Close'");
	});

	it('ignores a value left in an input of a field chosen earlier', () => {
		const rows = conditions({
			field: 'CardCode|text',
			operator: 'equal',
			value: 'C1',
			enumValue: 'bost_Open',
			dateValue: '2026-01-01T00:00:00',
		});

		expect(build({ conditions: rows })).toBe("CardCode eq 'C1'");
	});
});

describe('getConditionValueKind', () => {
	it.each([
		['DocumentStatus', 'enum'],
		['DocDate', 'date'],
		['CardCode', 'text'],
		['DocTotal', 'text'],
		['DocTime', 'text'],
		// A flags value may combine members; an enum without members has none to offer.
		['Permissions', 'text'],
		['Placeholder', 'text'],
	])('gives %s a %s value input', (name, kind) => {
		const property = orders.properties.find((candidate) => candidate.name === name);

		expect(getConditionValueKind(property?.edmType ?? '', metadata)).toBe(kind);
	});
});

describe('getConditionOperatorSet', () => {
	it.each([
		['CardCode', 'text'],
		['DocTotal', 'ordered'],
		['DocEntry', 'ordered'],
		['DocDate', 'ordered'],
		['DocTime', 'ordered'],
		['DocumentStatus', 'equality'],
		['Permissions', 'equality'],
		['Placeholder', 'equality'],
		['Printed', 'equality'],
	])('offers %s the %s operators', (name, set) => {
		const property = orders.properties.find((candidate) => candidate.name === name);

		expect(getConditionOperatorSet(property?.edmType ?? '', metadata)).toBe(set);
	});
});

describe('buildFilterExpression: the operator input the editor showed', () => {
	it('reads the comparison operator for a field with the ordered set', () => {
		const row = {
			field: 'DocTotal|text|ordered',
			operator: 'contains',
			comparisonOperator: 'greaterThan',
			value: '10',
		};

		expect(build({ conditions: conditions(row) })).toBe('DocTotal gt 10');
	});

	it('reads the equality operator for a field with the equality set', () => {
		const row = {
			field: 'DocumentStatus|enum|equality',
			operator: 'startsWith',
			equalityOperator: 'notEqual',
			enumValue: 'bost_Close',
		};

		expect(build({ conditions: conditions(row) })).toBe("DocumentStatus ne 'bost_Close'");
	});

	it('reads the operator with all operators for a field given without a set', () => {
		const row = {
			field: 'CardCode',
			operator: 'startsWith',
			comparisonOperator: 'lessThan',
			value: 'C',
		};

		expect(build({ conditions: conditions(row) })).toBe("startswith(CardCode,'C')");
	});

	it('defaults to Equal when the shown operator input is empty', () => {
		const row = { field: 'DocTotal|text|ordered', operator: 'contains', value: '5' };

		expect(build({ conditions: conditions(row) })).toBe('DocTotal eq 5');
	});
});

describe('getEnumMemberNames', () => {
	it('lists the members of a non-flags enum in declaration order', () => {
		expect(getEnumMemberNames('SAPB1.BoStatus', metadata)).toEqual(['bost_Open', 'bost_Close']);
	});

	it('lists none for a flags enum or a non-enum type', () => {
		expect(getEnumMemberNames('SAPB1.BoPermissionFlags', metadata)).toEqual([]);
		expect(getEnumMemberNames('Edm.String', metadata)).toEqual([]);
	});
});

describe('buildFilterExpression: Conditions', () => {
	it.each([
		['equal', 'eq'],
		['notEqual', 'ne'],
		['greaterThan', 'gt'],
		['greaterOrEqual', 'ge'],
		['lessThan', 'lt'],
		['lessOrEqual', 'le'],
	])('writes %s as %s', (operator, expected) => {
		expect(condition('DocTotal', operator, 10)).toBe(`DocTotal ${expected} 10`);
	});

	it.each([
		['contains', "contains(CardCode,'C')"],
		['startsWith', "startswith(CardCode,'C')"],
		['endsWith', "endswith(CardCode,'C')"],
		['notContains', "not contains(CardCode,'C')"],
		['notStartsWith', "not startswith(CardCode,'C')"],
		['notEndsWith', "not endswith(CardCode,'C')"],
	])('writes %s as %s', (operator, expected) => {
		expect(condition('CardCode', operator, 'C')).toBe(expected);
	});

	it('searches a number property as text', () => {
		expect(condition('DocTotal', 'contains', 15)).toBe("contains(DocTotal,'15')");
	});

	it('writes Is Empty and Is Not Empty as null comparisons, ignoring any value', () => {
		expect(condition('DocDate', 'isEmpty', 'leftover')).toBe('DocDate eq null');
		expect(condition('DocDate', 'isNotEmpty')).toBe('DocDate ne null');
	});

	it('compares with an empty string when no value is given', () => {
		expect(condition('CardCode', 'equal')).toBe("CardCode eq ''");
	});

	it('defaults to Equal when no operator is stored', () => {
		expect(build({ conditions: conditions({ field: 'CardCode', value: 'C1' }) })).toBe(
			"CardCode eq 'C1'",
		);
	});

	it('combines the conditions with and by default', () => {
		const rows = conditions(
			{ field: 'CardCode', operator: 'startsWith', value: 'C' },
			{ field: 'DocTotal', operator: 'greaterThan', value: '100' },
		);

		expect(build({ conditions: rows })).toBe("startswith(CardCode,'C') and DocTotal gt 100");
	});

	it('combines the conditions with or when chosen', () => {
		const rows = conditions(
			{ field: 'CardCode', operator: 'equal', value: 'C1' },
			{ field: 'CardCode', operator: 'equal', value: 'C2' },
		);

		expect(build({ conditions: rows, matchType: 'or' })).toBe(
			"CardCode eq 'C1' or CardCode eq 'C2'",
		);
	});
});

describe('buildFilterExpression: the Filter mode', () => {
	const rows = conditions({ field: 'DocTotal', operator: 'lessThan', value: '10' });
	const text = " DocTotal gt 1 or CardCode eq 'C1' ";

	it('sends the OData string exactly as entered, trimmed', () => {
		expect(build({ filterType: 'string', filterString: text })).toBe(
			"DocTotal gt 1 or CardCode eq 'C1'",
		);
	});

	it('sends only the source the mode picks, never a leftover from the other', () => {
		expect(build({ filterType: 'manual', conditions: rows, filterString: text })).toBe(
			'DocTotal lt 10',
		);
		expect(build({ filterType: 'string', conditions: rows, filterString: text })).toBe(
			"DocTotal gt 1 or CardCode eq 'C1'",
		);
	});

	it.each(['none', undefined, 'other'])('sends no filter for mode %j', (filterType) => {
		expect(build({ filterType, conditions: rows, filterString: text })).toBe('');
	});
});

describe('buildFilterExpression: rejected before sending', () => {
	it.each(['abc', '1,000', '12 CHF', '', true])('rejects %j on a number property', (value) => {
		expect(failure(() => condition('DocTotal', 'equal', value))).toContain(
			'Condition 1 ("DocTotal") needs a number',
		);
	});

	it('rejects anything but true or false on a boolean property', () => {
		expect(failure(() => condition('Printed', 'equal', 'yes'))).toContain('needs true or false');
	});

	it.each(['contains', 'notStartsWith', 'endsWith'])(
		'rejects %s on an enum property, which would silently match nothing',
		(operator) => {
			expect(failure(() => condition('DocumentStatus', operator, 'bost'))).toContain(
				'do not work on a dropdown (enum) field',
			);
		},
	);

	it('rejects a field the entity set does not have', () => {
		expect(failure(() => condition('NoSuchField', 'equal', '1'))).toContain(
			'"NoSuchField" is not a field of "Orders"',
		);
	});

	it.each(['DocumentLines', 'AddressExtension', 'Tags', 'Mystery'])(
		'rejects %s, which does not hold a single value',
		(field) => {
			expect(failure(() => equal(field, 'x'))).toContain('cannot be filtered on');
		},
	);

	it('rejects a condition without a field, counting from 1', () => {
		const rows = conditions({ field: 'CardCode', value: 'C1' }, { field: ' ', value: 'x' });

		expect(failure(() => build({ conditions: rows }))).toContain('Condition 2 has no field');
	});

	it('rejects an unknown operator', () => {
		expect(failure(() => condition('CardCode', 'between', 'x'))).toContain(
			'unknown operator "between"',
		);
	});
});
