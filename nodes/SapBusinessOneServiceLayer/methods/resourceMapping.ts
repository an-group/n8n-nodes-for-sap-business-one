import type { ILoadOptionsFunctions, ResourceMapperField, ResourceMapperFields } from 'n8n-workflow';

import { loadServiceLayerMetadata } from '../helpers/credentials';
import { classifyEdmType } from '../helpers/odataLiteral';
import type { EntityDefinition } from '../helpers/types';

function mapEdmTypeToFieldType(edmType: string): ResourceMapperField['type'] {
	const literalKind = classifyEdmType(edmType);

	if (literalKind === 'numeric') {
		return 'number';
	}

	if (literalKind === 'datetime') {
		return 'dateTime';
	}

	return 'string';
}

/**
 * Resolves the entity set currently selected on the node, or `undefined` while
 * none is picked yet (the mapper is rendered before the dropdown is filled).
 */
async function getSelectedEntity(
	this: ILoadOptionsFunctions,
): Promise<EntityDefinition | undefined> {
	const entitySetName = this.getNodeParameter('entitySet') as string;

	if (!entitySetName) {
		return undefined;
	}

	const metadata = await loadServiceLayerMetadata.call(this);

	return metadata.entities.get(entitySetName);
}

/**
 * Populates the Create/Update resource-mapper field list from the selected
 * entity set's metadata.
 *
 * Collection/navigation properties (e.g. `Orders.DocumentLines`) are excluded:
 * they are nested arrays of complex objects a flat field mapper cannot
 * represent, so entities whose meaningful data lives in a line-item
 * collection can only have their header fields set here.
 *
 * Key properties are included for Create (some entity sets require a
 * user-supplied key, e.g. `CardCode`; others are server-assigned, e.g.
 * `DocEntry` — metadata alone does not distinguish these, so the choice is
 * left to the user) but excluded for Update, since the key is already
 * supplied through `Key Fields` and the Service Layer does not support
 * changing an entity's key through a PATCH body.
 *
 * No field is marked `required`: the Service Layer's metadata marks many
 * properties non-nullable that it nonetheless assigns a default for, so
 * requiring all of them would force the user to fill in far more fields than
 * they actually need to set.
 */
export async function getEntityFields(this: ILoadOptionsFunctions): Promise<ResourceMapperFields> {
	const entity = await getSelectedEntity.call(this);

	if (entity === undefined) {
		return { fields: [] };
	}

	const operation = this.getNodeParameter('operation') as string;
	const keyNames = new Set(entity.keys.map((key) => key.name));

	const fields: ResourceMapperField[] = entity.properties
		.filter((property) => !property.isCollection)
		.filter((property) => operation !== 'update' || !keyNames.has(property.name))
		.map((property) => ({
			id: property.name,
			displayName: property.name,
			type: mapEdmTypeToFieldType(property.edmType),
			required: false,
			defaultMatch: false,
			canBeUsedToMatch: false,
			display: true,
		}));

	return { fields };
}

/**
 * Populates the Get/Update/Delete `Key Fields` resource-mapper field list
 * from the selected entity set's metadata: one field per key property,
 * labelled with the property's own name (e.g. `ItemCode` for `Items`), so the
 * user never has to know or type a key's name from memory.
 */
export async function getEntityKeys(this: ILoadOptionsFunctions): Promise<ResourceMapperFields> {
	const entity = await getSelectedEntity.call(this);

	if (entity === undefined) {
		return { fields: [] };
	}

	if (entity.keys.length === 0) {
		return {
			fields: [],
			emptyFieldsNotice: `No key fields found for entity set "${entity.entitySetName}".`,
		};
	}

	const fields: ResourceMapperField[] = entity.keys.map((key) => ({
		id: key.name,
		displayName: key.name,
		type: mapEdmTypeToFieldType(key.edmType),
		required: true,
		defaultMatch: true,
		canBeUsedToMatch: true,
		display: true,
	}));

	return { fields };
}
