import { describe, expect, it } from 'vitest';

import { buildEntityQueryString } from '../nodes/SapBusinessOneServiceLayer/helpers/queryOptions';

function sortRows(...rows: Array<{ field?: unknown; direction?: unknown }>) {
	return { fields: rows };
}

describe('buildEntityQueryString', () => {
	it('returns an empty string when no option is set', () => {
		expect(buildEntityQueryString({})).toBe('');
	});

	it('returns an empty string when every option is empty', () => {
		expect(buildEntityQueryString({ select: [], filter: '   ', sort: {} })).toBe('');
	});

	it('joins the selected fields into $select', () => {
		expect(buildEntityQueryString({ select: ['DocEntry', 'CardCode'] })).toBe(
			'?$select=DocEntry%2CCardCode',
		);
	});

	it('accepts a comma-separated string from an expression, trimming blanks', () => {
		expect(buildEntityQueryString({ select: ' DocEntry , ,CardCode ' })).toBe(
			'?$select=DocEntry%2CCardCode',
		);
	});

	it('ignores a select value that is neither a list nor a string', () => {
		expect(buildEntityQueryString({ select: 42 })).toBe('');
	});

	it('sends the filter as entered, percent-encoded and trimmed', () => {
		expect(buildEntityQueryString({ filter: " DocTotal gt 1000 and CardCode eq 'C1' " })).toBe(
			"?$filter=DocTotal%20gt%201000%20and%20CardCode%20eq%20'C1'",
		);
	});

	it('encodes characters that would otherwise split or cut off the URL', () => {
		// `&` would start a new query option, `#` a fragment, and `%` an escape.
		expect(buildEntityQueryString({ filter: "ItemName eq 'A&B #1 100%'" })).toBe(
			"?$filter=ItemName%20eq%20'A%26B%20%231%20100%25'",
		);
	});

	it('keeps doubled quotes inside a string literal', () => {
		expect(buildEntityQueryString({ filter: "CardName eq 'O''Brien'" })).toBe(
			"?$filter=CardName%20eq%20'O''Brien'",
		);
	});

	it('builds $orderby from the sort rows in the order given', () => {
		expect(
			buildEntityQueryString({
				sort: sortRows(
					{ field: 'DocDate', direction: 'desc' },
					{ field: 'DocEntry', direction: 'asc' },
				),
			}),
		).toBe('?$orderby=DocDate%20desc%2CDocEntry%20asc');
	});

	it('treats anything but desc as ascending', () => {
		expect(buildEntityQueryString({ sort: sortRows({ field: 'DocEntry' }) })).toBe(
			'?$orderby=DocEntry%20asc',
		);
	});

	it('skips sort rows without a field', () => {
		expect(
			buildEntityQueryString({
				sort: sortRows(
					{ field: '  ', direction: 'desc' },
					{ field: 'DocEntry', direction: 'desc' },
				),
			}),
		).toBe('?$orderby=DocEntry%20desc');
	});

	it('ignores a malformed sort value', () => {
		expect(buildEntityQueryString({ sort: { fields: 'DocEntry' } })).toBe('');
	});

	it('combines all options as $select, $filter, $orderby', () => {
		expect(
			buildEntityQueryString({
				sort: sortRows({ field: 'DocEntry', direction: 'desc' }),
				filter: 'DocTotal gt 1000',
				select: ['DocEntry'],
			}),
		).toBe('?$select=DocEntry&$filter=DocTotal%20gt%201000&$orderby=DocEntry%20desc');
	});
});
