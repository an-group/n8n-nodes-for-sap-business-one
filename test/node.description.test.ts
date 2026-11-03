import type { INodeProperties, INodePropertyOptions } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { SapBusinessOneServiceLayer } from '../nodes/SapBusinessOneServiceLayer/SapBusinessOneServiceLayer.node';

const node = new SapBusinessOneServiceLayer();
const { properties } = node.description;

function resourceOptions(): INodePropertyOptions[] {
	const resource = properties.find((property) => property.name === 'resource');

	return (resource?.options ?? []) as INodePropertyOptions[];
}

/**
 * The operation parameter n8n's nodes panel reads for a resource: the first
 * property named `operation` whose `displayOptions.show.resource` names it
 * (n8n editor-ui, node creator action parser for resource-based nodes).
 */
function operationFor(resource: string): INodeProperties | undefined {
	return properties.find(
		(property) =>
			property.name === 'operation' &&
			(property.displayOptions?.show?.resource as string[] | undefined)?.includes(resource),
	);
}

/** The actions the nodes panel shows, in resource order. */
function panelActions(): string[] {
	return resourceOptions().flatMap((resource) =>
		((operationFor(String(resource.value))?.options ?? []) as INodePropertyOptions[]).map(
			(option) => option.action ?? '',
		),
	);
}

describe('Nodes panel actions', () => {
	it('gives every resource an operation, so none is missing from the panel', () => {
		for (const resource of resourceOptions()) {
			expect(operationFor(String(resource.value)), String(resource.value)).toBeDefined();
		}
	});

	it('gives every operation option an action and a description', () => {
		for (const resource of resourceOptions()) {
			const options = (operationFor(String(resource.value))?.options ?? []) as INodePropertyOptions[];

			for (const option of options) {
				expect(option.action, String(option.value)).toBeTruthy();
				expect(option.description, String(option.value)).toBeTruthy();
			}
		}
	});

	it('lists the eight actions, grouped by resource', () => {
		expect(panelActions()).toEqual([
			'Create entity',
			'Delete entity',
			'Execute action or function on entity',
			'Get entity',
			'Get many entities',
			'Update entity',
			'Call service operation',
			'Send custom API request',
		]);
	});

	it('defaults each single-action resource to its only operation', () => {
		expect(operationFor('serviceOperation')?.default).toBe('call');
		expect(operationFor('customApiCall')?.default).toBe('request');
	});

	it("never uses the value n8n reserves for its own custom API call and hides from the panel", () => {
		const values = resourceOptions().flatMap((resource) =>
			((operationFor(String(resource.value))?.options ?? []) as INodePropertyOptions[]).map(
				(option) => option.value,
			),
		);

		expect(values).not.toContain('__CUSTOM_API_CALL__');
	});
});

describe('OData Expression filter', () => {
	it('names the filter mode and its input alike', () => {
		const filterType = properties.find((property) => property.name === 'filterType');
		const input = properties.find((property) => property.name === 'odataFilter');

		expect(filterType?.options).toContainEqual(
			expect.objectContaining({ name: 'OData Expression', value: 'odata' }),
		);
		expect(input?.displayName).toBe('OData Expression');
		expect(input?.displayOptions?.show?.filterType).toEqual(['odata']);
	});
});

describe('Field selection of Get and Get Many', () => {
	const entitySetProperties = properties.filter((property) =>
		(property.displayOptions?.show?.resource as string[] | undefined)?.includes('entitySet'),
	);

	it('is a parameter of its own, not an option', () => {
		const select = entitySetProperties.find((property) => property.name === 'select');

		expect(select).toMatchObject({
			displayName: 'Select Field Names or IDs',
			type: 'multiOptions',
			typeOptions: { loadOptionsMethod: 'getSelectableFields' },
		});
		expect(select?.displayOptions?.show?.operation).toEqual(['get', 'getMany']);
	});

	it('is optional and returns every field when left empty', () => {
		const select = entitySetProperties.find((property) => property.name === 'select');

		expect(select?.required).toBeFalsy();
		expect(select?.default).toEqual([]);
	});

	it('leaves Get and Get Many without an Options collection', () => {
		const options = entitySetProperties.filter((property) => property.name === 'options');

		expect(options).toEqual([]);
	});

	it('comes right after Limit, ahead of the filter and Sort', () => {
		const names = entitySetProperties.map((property) => property.name);

		expect(names.indexOf('select')).toBe(names.indexOf('limit') + 1);
		expect(names.indexOf('select')).toBeLessThan(names.indexOf('filterType'));
		expect(names.indexOf('select')).toBeLessThan(names.indexOf('sort'));
	});
});

describe('Resource Locators', () => {
	const locators: Array<[name: string, searchListMethod: string]> = [
		['entitySet', 'searchEntitySets'],
		['boundOperation', 'searchBoundOperations'],
		['serviceOperation', 'searchServiceOperations'],
	];

	it.each(locators)('%s defaults to From list, backed by %s', (name, searchListMethod) => {
		const property = properties.find((candidate) => candidate.name === name);

		expect(property?.type).toBe('resourceLocator');
		expect(property?.default).toEqual({ mode: 'list', value: '' });
		expect(property?.modes?.map((mode) => mode.name)).toEqual(['list', 'name']);

		const list = property?.modes?.find((mode) => mode.name === 'list');
		expect(list?.typeOptions?.searchListMethod).toBe(searchListMethod);
		expect(list?.typeOptions?.searchable).toBe(true);
		expect(node.methods.listSearch[searchListMethod as keyof typeof node.methods.listSearch]).toBeTypeOf(
			'function',
		);
	});

	it('gives every By Name mode an e.g. placeholder', () => {
		for (const [name] of locators) {
			const mode = properties
				.find((candidate) => candidate.name === name)
				?.modes?.find((candidate) => candidate.name === 'name');

			expect(mode?.placeholder, name).toMatch(/^e\.g\. /);
		}
	});

	it('reads the locators in the subtitle as plain values', () => {
		// n8n's $parameter already resolves a locator to its value
		// (workflow-data-proxy, isResourceLocatorValue), so `.value` would show "undefined".
		expect(node.description.subtitle).not.toMatch(/\.value/);
		expect(node.description.subtitle).toContain('$parameter["entitySet"]');
	});

	it('makes every dependent list depend on the locator value, not the locator object', () => {
		const dependencies = JSON.stringify(properties).match(/"loadOptionsDependsOn":\[[^\]]*\]/g) ?? [];

		expect(dependencies.length).toBeGreaterThan(0);
		for (const dependency of dependencies) {
			expect(dependency).not.toMatch(/"(entitySet|boundOperation|serviceOperation)"/);
		}
	});
});
