import type { ILoadOptionsFunctions, INodePropertyOptions } from 'n8n-workflow';

import { loadServiceLayerMetadata } from '../helpers/credentials';
import { classifyServiceLayerType } from '../helpers/typeClassification';
import type { EntityDefinition, EntityPropertyDefinition } from '../helpers/types';

/** Populates the Entity Set dropdown from the connected instance's metadata. */
export async function getEntitySets(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const metadata = await loadServiceLayerMetadata.call(this);

	return [...metadata.entities.keys()]
		.sort((a, b) => a.localeCompare(b))
		.map((name) => ({ name, value: name }));
}

/**
 * Populates the Service Operation dropdown with the unbound Actions and
 * Functions from the connected instance's metadata. The kind is part of the
 * label, so there is no separate Action/Function selector; the value is the
 * bare import name the request is sent to.
 */
export async function getServiceOperations(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const metadata = await loadServiceLayerMetadata.call(this);

	return toOperationOptions(metadata.unboundOperations);
}

/**
 * Populates the Action or Function dropdown with the operations bound to the
 * selected entity set's entity type. Names such as `Close` are shared by many
 * types; resolving through the entity set keeps only the selected type's own.
 */
export async function getBoundOperations(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const entity = await loadSelectedEntity.call(this);

	if (entity === undefined) {
		return [];
	}

	return toOperationOptions([...entity.boundActions, ...entity.boundFunctions]);
}

/**
 * Populates the `Select Field Names or IDs` multi-select (`$select`) with every property of the
 * selected entity set, collections and complex properties included: a live
 * Service Layer accepts `$select=DocEntry,DocumentLines` and returns the lines
 * in full.
 */
export async function getSelectableFields(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const entity = await loadSelectedEntity.call(this);

	return toFieldOptions(entity?.properties ?? []);
}

/**
 * Populates the `Sort` field dropdown (`$orderby`). Only single primitive and
 * enum values can be ordered by; collections and complex properties are left
 * out.
 */
export async function getSortableFields(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const entity = await loadSelectedEntity.call(this);

	if (entity === undefined) {
		return [];
	}

	const metadata = await loadServiceLayerMetadata.call(this);

	return toFieldOptions(
		entity.properties.filter((property) => {
			const typeInfo = classifyServiceLayerType(property.edmType, metadata);

			return (
				!typeInfo.isCollection &&
				(typeInfo.category === 'primitive' || typeInfo.category === 'enum')
			);
		}),
	);
}

async function loadSelectedEntity(
	this: ILoadOptionsFunctions,
): Promise<EntityDefinition | undefined> {
	const entitySetName = this.getNodeParameter('entitySet') as string;

	if (!entitySetName) {
		return undefined;
	}

	const metadata = await loadServiceLayerMetadata.call(this);

	return metadata.entities.get(entitySetName);
}

function toFieldOptions(properties: EntityPropertyDefinition[]): INodePropertyOptions[] {
	return properties
		.map((property) => property.name)
		.sort((a, b) => a.localeCompare(b))
		.map((name) => ({ name, value: name }));
}

function toOperationOptions(
	operations: Array<{ name: string; kind: 'action' | 'function' }>,
): INodePropertyOptions[] {
	return [...operations]
		.sort((a, b) => a.name.localeCompare(b.name))
		.map((operation) => ({
			name: `${operation.name} (${operation.kind === 'action' ? 'Action' : 'Function'})`,
			value: operation.name,
		}));
}
