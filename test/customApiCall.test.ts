import { NodeOperationError } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import {
	normalizeCustomEndpoint,
	parseJsonBody,
	toCustomApiCallOutput,
} from '../nodes/SapBusinessOneServiceLayer/helpers/customApiCall';
import { flattenErrorText } from './helpers/errors';
import { createTestNode } from './helpers/node';

const context = { getNode: () => createTestNode() };

describe('normalizeCustomEndpoint', () => {
	it.each([
		['/Orders(45)', '/Orders(45)'],
		['Orders(45)', '/Orders(45)'],
		['  /Orders(45)  ', '/Orders(45)'],
		['/Orders?$top=10&$orderby=DocEntry desc', '/Orders?$top=10&$orderby=DocEntry desc'],
		['/Orders(45)/Close', '/Orders(45)/Close'],
		['/CompanyService_GetCompanyInfo()', '/CompanyService_GetCompanyInfo()'],
		["/Items('A..B')", "/Items('A..B')"],
		['/LoginHistory', '/LoginHistory'],
		["/Orders?$filter=CardCode eq '..'", "/Orders?$filter=CardCode eq '..'"],
	])('accepts %s', (input, expected) => {
		expect(normalizeCustomEndpoint(context, input)).toBe(expected);
	});

	it.each([
		['an https URL', 'https://evil.invalid/b1s/v2/Orders'],
		['an upper-case scheme', 'HTTP://evil.invalid/Orders'],
		['a scheme without slashes', 'mailto:someone@evil.invalid'],
		['a protocol-relative URL', '//evil.invalid/Orders'],
		['a backslash host', '\\\\evil.invalid\\Orders'],
		['a single leading backslash', '\\Orders'],
	])('rejects %s as not relative', (_label, input) => {
		expect(() => normalizeCustomEndpoint(context, input)).toThrow(
			'Only relative Service Layer endpoints are allowed',
		);
	});

	it.each([
		['a raw parent segment', '/../Orders'],
		['a nested parent segment', '/Orders/../../x'],
		['a percent-encoded parent segment', '/Orders/%2E%2E/x'],
		['a mixed-encoding parent segment', '/Orders/.%2e/x'],
		['a backslash-separated parent segment', '/Orders\\..\\x'],
	])('rejects %s', (_label, input) => {
		expect(() => normalizeCustomEndpoint(context, input)).toThrow(
			'The endpoint must not contain ".." path segments',
		);
	});

	it.each(['/Login', 'login', '/LOGOUT?x=1', '/Logout/', '/%4Cogin'])(
		'rejects the session endpoint %s',
		(input) => {
			expect(() => normalizeCustomEndpoint(context, input)).toThrow(
				'The Login and Logout endpoints cannot be called directly',
			);
		},
	);

	it.each([
		['an empty string', ''],
		['whitespace only', '   '],
		['a non-string', 42],
	])('rejects %s as empty', (_label, input) => {
		expect(() => normalizeCustomEndpoint(context, input)).toThrow('The endpoint is empty');
	});

	it.each([
		['a line break', '/Orders\n/x'],
		['an inner tab', '/Orders\t/x'],
		['a NUL character', '/Orders\u0000'],
	])('rejects %s', (_label, input) => {
		expect(() => normalizeCustomEndpoint(context, input)).toThrow(
			'The endpoint contains control characters',
		);
	});
});

describe('parseJsonBody', () => {
	it.each([
		['undefined', undefined],
		['null', null],
		['an empty string', ''],
		['whitespace only', ' \n '],
	])('sends no body for %s', (_label, input) => {
		expect(parseJsonBody(context, input)).toBeUndefined();
	});

	it('parses a JSON object string', () => {
		expect(parseJsonBody(context, '{"CardCode":"C1","Lines":[1,2]}')).toEqual({
			CardCode: 'C1',
			Lines: [1, 2],
		});
	});

	it('parses a JSON array string', () => {
		expect(parseJsonBody(context, '[{"a":1}]')).toEqual([{ a: 1 }]);
	});

	it('uses an object from an expression as-is', () => {
		const body = { CardCode: 'C1' };

		expect(parseJsonBody(context, body)).toBe(body);
	});

	it('rejects invalid JSON without echoing it', async () => {
		const error = await Promise.resolve()
			.then(() => parseJsonBody(context, '{"CardCode": leaked-value,}'))
			.catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(NodeOperationError);
		expect(flattenErrorText(error)).toContain('The JSON body is not valid JSON');
		expect(flattenErrorText(error)).not.toContain('leaked-value');
	});

	it.each([
		['a number', '5'],
		['a string', '"text"'],
		['null', 'null'],
		['a boolean', 'true'],
	])('rejects %s as a body', (_label, input) => {
		expect(() => parseJsonBody(context, input)).toThrow(
			'The JSON body must be a JSON object or array',
		);
	});

	it('rejects a non-string, non-object value', () => {
		expect(() => parseJsonBody(context, 12)).toThrow(
			'The JSON body must be a JSON object or array',
		);
	});
});

describe('toCustomApiCallOutput', () => {
	it('returns an object body unchanged, including an unsplit collection', () => {
		const body = { value: [{ DocEntry: 1 }, { DocEntry: 2 }] };

		expect(toCustomApiCallOutput(body, 200)).toBe(body);
	});

	it.each([
		['an empty string', ''],
		['undefined', undefined],
		['null', null],
	])('reports success for %s', (_label, body) => {
		expect(toCustomApiCallOutput(body, 204)).toEqual({ success: true, statusCode: 204 });
	});

	it.each([
		['text', '<edmx:Edmx/>'],
		['a number', 42],
		['an array', [1, 2]],
	])('wraps %s under data', (_label, body) => {
		expect(toCustomApiCallOutput(body, 200)).toEqual({ data: body });
	});
});
