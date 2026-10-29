import type { FunctionsBase, IDataObject } from 'n8n-workflow';

import { isUnset, parseStructuredValue, type StructuredShape } from './structuredValue';
import { classifyServiceLayerType } from './typeClassification';
import type { EntityDefinition, EntityPropertyDefinition, ServiceLayerMetadata } from './types';

type NodeContext = Pick<FunctionsBase, 'getNode'>;

export type TypeRegistry = Pick<
	ServiceLayerMetadata,
	'complexTypes' | 'enumTypeNames' | 'entityTypes'
>;

/**
 * How an entity property's value is entered and sent in a Create/Update body.
 *
 * Every collection (e.g. `DocumentLines`) is an `array` and every single
 * complex or entity-typed property (e.g. `AddressExtension`) an `object`, both
 * entered as JSON. Primitive, enum, and undeclared types stay `primitive`,
 * so their fields keep the type derived from the EDM name.
 */
export function getEntityPropertyShape(
	edmType: string,
	metadata: TypeRegistry,
): 'primitive' | StructuredShape {
	const typeInfo = classifyServiceLayerType(edmType, metadata);

	if (typeInfo.isCollection) {
		return 'array';
	}

	if (typeInfo.category === 'complex' || typeInfo.category === 'entity') {
		return 'object';
	}

	return 'primitive';
}

/**
 * Builds a Create/Update request body from the `Fields` mapper values,
 * parsing collection and complex properties from JSON into nested arrays and
 * objects.
 *
 * Primitive values, and keys the entity type does not declare, are passed
 * through unchanged. A structured field that is empty at runtime (an
 * expression yielding `''` or `null`) is left out — it cannot be a JSON array
 * or object. The editor itself never stores an empty field.
 */
export function buildEntityBody(
	context: NodeContext,
	entity: EntityDefinition,
	metadata: TypeRegistry,
	mappedValues: IDataObject,
): IDataObject {
	const propertiesByName = new Map(entity.properties.map((property) => [property.name, property]));
	const body: IDataObject = {};

	for (const [name, raw] of Object.entries(mappedValues)) {
		const property = propertiesByName.get(name);

		if (property === undefined) {
			body[name] = raw;
			continue;
		}

		const value = toPropertyValue(context, property, metadata, raw);

		if (value !== undefined) {
			body[name] = value;
		}
	}

	return body;
}

/**
 * Converts one mapper value of a declared property: primitives pass through,
 * collection and complex values are parsed from JSON. Returns `undefined` for
 * a structured value that is empty, which is then left out.
 */
export function toPropertyValue(
	context: NodeContext,
	property: EntityPropertyDefinition,
	metadata: TypeRegistry,
	raw: unknown,
): IDataObject[string] | undefined {
	const shape = getEntityPropertyShape(property.edmType, metadata);

	if (shape === 'primitive') {
		return raw as IDataObject[string];
	}

	if (isUnset(raw)) {
		return undefined;
	}

	return parseStructuredValue(
		context,
		{ kind: 'field', name: property.name, edmType: property.edmType },
		shape,
		raw,
	) as IDataObject | IDataObject[];
}
