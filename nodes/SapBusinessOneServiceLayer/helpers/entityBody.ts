import type { FunctionsBase, IDataObject } from 'n8n-workflow';

import { isUnset, parseStructuredValue, type StructuredShape } from './structuredValue';
import { classifyServiceLayerType } from './typeClassification';
import type { EntityDefinition, ServiceLayerMetadata } from './types';

type NodeContext = Pick<FunctionsBase, 'getNode'>;

type TypeRegistry = Pick<
	ServiceLayerMetadata,
	'complexTypes' | 'enumTypeNames' | 'entityTypeNames'
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

		const shape = getEntityPropertyShape(property.edmType, metadata);

		if (shape === 'primitive') {
			body[name] = raw;
			continue;
		}

		if (isUnset(raw)) {
			continue;
		}

		body[name] = parseStructuredValue(
			context,
			{ kind: 'field', name, edmType: property.edmType },
			shape,
			raw,
		) as IDataObject | IDataObject[];
	}

	return body;
}
