import { describe, expect, it } from 'vitest';

import {
	classifyEdmType,
	encodeODataLiteral,
	formatODataLiteral,
} from '../nodes/SapBusinessOneServiceLayer/helpers/odataLiteral';

describe('classifyEdmType', () => {
	it('treats Edm.String as the only quoted EDM primitive', () => {
		expect(classifyEdmType('Edm.String')).toBe('string');
	});

	it.each(['Edm.DateTimeOffset', 'Edm.TimeOfDay', 'Edm.Date', 'Edm.Duration'])(
		'classifies %s as datetime',
		(edmType) => {
			expect(classifyEdmType(edmType)).toBe('datetime');
		},
	);

	it.each([
		'Edm.Int16',
		'Edm.Int32',
		'Edm.Int64',
		'Edm.Byte',
		'Edm.Decimal',
		'Edm.Double',
		'Edm.Single',
		'Edm.Boolean',
		'Edm.Guid',
	])('classifies %s as numeric', (edmType) => {
		expect(classifyEdmType(edmType)).toBe('numeric');
	});

	it.each([
		['SAPB1.BoYesNoEnum', 'a SAP enum type'],
		['SAPB1.DocumentLine', 'a SAP complex type'],
		['', 'an empty type name'],
		['Edm', 'a bare "Edm" with no dot'],
	])('treats %s (%s) as an opaque string', (edmType) => {
		expect(classifyEdmType(edmType)).toBe('string');
	});

	it('falls back to string for a collection type', () => {
		expect(classifyEdmType('Collection(Edm.String)')).toBe('string');
	});
});

describe('encodeODataLiteral', () => {
	it.each([
		['45', '45'],
		['  45  ', '45'],
		['-3', '-3'],
		['0', '0'],
	])('leaves numeric %s unquoted as %s', (raw, expected) => {
		expect(encodeODataLiteral(raw, 'numeric')).toBe(expected);
	});

	it('leaves a datetime literal unquoted and does not encode its separators', () => {
		expect(encodeODataLiteral('2024-01-02T03:04:05Z', 'datetime')).toBe('2024-01-02T03:04:05Z');
	});

	it('trims a datetime literal', () => {
		expect(encodeODataLiteral(' 2024-01-02 ', 'datetime')).toBe('2024-01-02');
	});

	it('quotes a plain string', () => {
		expect(encodeODataLiteral('AK', 'string')).toBe("'AK'");
	});

	it("doubles an embedded quote and leaves the doubled form un-encoded", () => {
		// encodeURIComponent does not touch "'", so the OData escaping survives.
		expect(encodeODataLiteral("O'Brien", 'string')).toBe("'O''Brien'");
	});

	it.each([
		['A#B', "'A%23B'"],
		['a/b', "'a%2Fb'"],
		['a?b', "'a%3Fb'"],
		['a%b', "'a%25b'"],
		['a b', "'a%20b'"],
		['Ö', "'%C3%96'"],
	])('percent-encodes %s to %s', (raw, expected) => {
		expect(encodeODataLiteral(raw, 'string')).toBe(expected);
	});

	it('replaces quotes before percent-encoding', () => {
		// Encoding first would yield 'O%27Brien%231' instead.
		expect(encodeODataLiteral("O'Brien#1", 'string')).toBe("'O''Brien%231'");
	});

	it('encodes an empty string as an empty OData literal', () => {
		expect(encodeODataLiteral('', 'string')).toBe("''");
	});

	it('does not trim a string literal, unlike a numeric one', () => {
		expect(encodeODataLiteral(' AK ', 'string')).toBe("'%20AK%20'");
	});
});

describe('formatODataLiteral', () => {
	it('quotes a string and doubles an embedded quote, without URL encoding', () => {
		expect(formatODataLiteral("O'Brien #1 & 100%", 'string')).toBe("'O''Brien #1 & 100%'");
	});

	it('keeps the spaces of a string', () => {
		expect(formatODataLiteral(' AK ', 'string')).toBe("' AK '");
	});

	it('trims numeric and datetime values and leaves them bare', () => {
		expect(formatODataLiteral(' 42 ', 'numeric')).toBe('42');
		expect(formatODataLiteral(' 2024-01-02 ', 'datetime')).toBe('2024-01-02');
	});

	it('is what encodeODataLiteral percent-encodes', () => {
		const raw = "O'Brien#1";

		expect(encodeODataLiteral(raw, 'string')).toBe(
			encodeURIComponent(formatODataLiteral(raw, 'string')),
		);
	});
});
