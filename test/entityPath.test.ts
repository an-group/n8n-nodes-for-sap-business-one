import { NodeOperationError } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { buildEntityKeySegment } from '../nodes/SapBusinessOneServiceLayer/helpers/entityPath';
import type { EntityDefinition } from '../nodes/SapBusinessOneServiceLayer/helpers/types';
import { flattenErrorText } from './helpers/errors';
import { createTestNode } from './helpers/node';

const context = { getNode: () => createTestNode() };

function entity(overrides: Partial<EntityDefinition>): EntityDefinition {
	return {
		entitySetName: 'Orders',
		entityTypeName: 'Order',
		keys: [],
		properties: [],
		boundActions: [],
		boundFunctions: [],
		...overrides,
	};
}

const orders = entity({
	keys: [{ name: 'DocEntry', edmType: 'Edm.Int32', literalKind: 'numeric' }],
});

const items = entity({
	entitySetName: 'Items',
	entityTypeName: 'Item',
	keys: [{ name: 'ItemCode', edmType: 'Edm.String', literalKind: 'string' }],
});

const salesTaxAuthorities = entity({
	entitySetName: 'SalesTaxAuthorities',
	entityTypeName: 'SalesTaxAuthority',
	keys: [
		{ name: 'Type', edmType: 'Edm.Int32', literalKind: 'numeric' },
		{ name: 'Code', edmType: 'Edm.String', literalKind: 'string' },
	],
});

describe('buildEntityKeySegment', () => {
	it('builds a bare segment for a single numeric key', () => {
		expect(buildEntityKeySegment(context, orders, { DocEntry: 45 })).toBe('Orders(45)');
	});

	it('accepts a single key supplied as a string', () => {
		expect(buildEntityKeySegment(context, orders, { DocEntry: '45' })).toBe('Orders(45)');
	});

	it('quotes and percent-encodes a single string key', () => {
		expect(buildEntityKeySegment(context, items, { ItemCode: 'A#B' })).toBe("Items('A%23B')");
	});

	it('names each part of a composite key, in metadata order', () => {
		// Values are supplied in the reverse of the metadata order on purpose: the
		// segment must follow `entity.keys`, not the value object's insertion order.
		expect(
			buildEntityKeySegment(context, salesTaxAuthorities, { Code: 'AK', Type: -3 }),
		).toBe("SalesTaxAuthorities(Type=-3,Code='AK')");
	});

	it('handles a three-part composite key', () => {
		const alternateCatNum = entity({
			entitySetName: 'AlternateCatNum',
			entityTypeName: 'AlternateCatNum',
			keys: [
				{ name: 'ItemCode', edmType: 'Edm.String', literalKind: 'string' },
				{ name: 'CardCode', edmType: 'Edm.String', literalKind: 'string' },
				{ name: 'Substitute', edmType: 'Edm.String', literalKind: 'string' },
			],
		});

		expect(
			buildEntityKeySegment(context, alternateCatNum, {
				ItemCode: 'I1',
				CardCode: 'C1',
				Substitute: 'S1',
			}),
		).toBe("AlternateCatNum(ItemCode='I1',CardCode='C1',Substitute='S1')");
	});

	it('treats 0 as a real key value, not a missing one', () => {
		expect(buildEntityKeySegment(context, orders, { DocEntry: 0 })).toBe('Orders(0)');
	});

	it('treats false as a real key value, not a missing one', () => {
		const flags = entity({
			entitySetName: 'Flags',
			keys: [{ name: 'Active', edmType: 'Edm.Boolean', literalKind: 'numeric' }],
		});

		expect(buildEntityKeySegment(context, flags, { Active: false })).toBe('Flags(false)');
	});

	it('renders an empty segment for an entity with no keys', () => {
		expect(buildEntityKeySegment(context, entity({ entitySetName: 'Foo' }), {})).toBe('Foo()');
	});

	it.each([
		['undefined', undefined],
		['null', null],
		['an empty string', ''],
	])('rejects %s as a key value', (_label, value) => {
		expect(() => buildEntityKeySegment(context, orders, { DocEntry: value })).toThrow(
			NodeOperationError,
		);
	});

	it('uses singular wording when one key is missing', () => {
		expect(() =>
			buildEntityKeySegment(context, salesTaxAuthorities, { Type: -3 }),
		).toThrow('Key field Code has no value');
	});

	it('uses plural wording when several keys are missing', () => {
		expect(() => buildEntityKeySegment(context, salesTaxAuthorities, {})).toThrow(
			'Key fields Type, Code have no value',
		);
	});

	it('describes every key of the entity when one is missing', async () => {
		// Captured via .catch rather than try/catch: require-node-api-error rejects
		// any throw from inside a catch block, in test files as much as in source.
		const error = await Promise.resolve()
			.then(() => buildEntityKeySegment(context, salesTaxAuthorities, {}))
			.catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(NodeOperationError);
		expect(flattenErrorText(error)).toContain(
			'"SalesTaxAuthorities" is identified by Type, Code',
		);
	});
});
