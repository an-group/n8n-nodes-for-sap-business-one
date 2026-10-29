import type {
	ILoadOptionsFunctions,
	ResourceMapperField,
	ResourceMapperFields,
} from 'n8n-workflow';

import { loadServiceLayerMetadata } from '../helpers/credentials';
import { getEntityPropertyShape } from '../helpers/entityBody';
import { classifyEdmType } from '../helpers/odataLiteral';
import { getExpandedParameter, getOperationParameterShape } from '../helpers/serviceOperation';
import { classifyServiceLayerType } from '../helpers/typeClassification';
import type {
	EntityPropertyDefinition,
	OperationParameter,
	ServiceLayerMetadata,
	EntityDefinition,
} from '../helpers/types';

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
 * The field of a property or parameter entered as a single value. An enum gets
 * a dropdown of its member names, sent unchanged (e.g. `tYES`); a flags enum,
 * whose value may combine several members, and an enum without members keep a
 * free-text field.
 */
function getSingleValueField(
	edmType: string,
	metadata: ServiceLayerMetadata,
): Pick<ResourceMapperField, 'type' | 'options'> {
	const typeInfo = classifyServiceLayerType(edmType, metadata);
	const enumType =
		typeInfo.category === 'enum' ? metadata.enumTypes.get(typeInfo.typeName) : undefined;

	if (enumType !== undefined && !enumType.isFlags && enumType.members.length > 0) {
		return {
			type: 'options',
			options: enumType.members.map((member) => ({ name: member.name, value: member.name })),
		};
	}

	return { type: mapEdmTypeToFieldType(edmType) };
}

/**
 * Resolves the entity set currently selected on the node, or `undefined` while
 * none is picked yet (the mapper is rendered before the dropdown is filled).
 */
async function getSelectedEntity(
	this: ILoadOptionsFunctions,
): Promise<EntityDefinition | undefined> {
	return (await getSelectedEntityWithMetadata.call(this))?.entity;
}

async function getSelectedEntityWithMetadata(
	this: ILoadOptionsFunctions,
): Promise<{ entity: EntityDefinition; metadata: ServiceLayerMetadata } | undefined> {
	const entitySetName = this.getNodeParameter('entitySet') as string;

	if (!entitySetName) {
		return undefined;
	}

	const metadata = await loadServiceLayerMetadata.call(this);
	const entity = metadata.entities.get(entitySetName);

	return entity === undefined ? undefined : { entity, metadata };
}

/**
 * Populates the Create/Update resource-mapper field list from the selected
 * entity set's metadata.
 *
 * Collection properties (e.g. `Orders.DocumentLines`) are offered as `array`
 * fields and single complex properties (e.g. `AddressExtension`) as `object`
 * fields, both with a JSON editor; see `getEntityPropertyShape`. Enum
 * properties (e.g. `BoYesNoEnum`) are dropdowns of their member names.
 * Navigation properties are not parsed and never offered.
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
	const selected = await getSelectedEntityWithMetadata.call(this);

	if (selected === undefined) {
		return { fields: [] };
	}

	const { entity, metadata } = selected;
	const operation = this.getNodeParameter('operation') as string;
	const keyNames = new Set(entity.keys.map((key) => key.name));

	const fields = getPropertyFields(
		entity.properties.filter((property) => operation !== 'update' || !keyNames.has(property.name)),
		metadata,
	);

	return { fields };
}

/**
 * One mapper field per property of an entity or complex type. Collection and
 * complex properties get a JSON editor (`array`/`object`), see
 * `getEntityPropertyShape`; enum properties a dropdown, see
 * `getSingleValueField`.
 */
function getPropertyFields(
	properties: EntityPropertyDefinition[],
	metadata: ServiceLayerMetadata,
): ResourceMapperField[] {
	return properties.map((property) => {
		const shape = getEntityPropertyShape(property.edmType, metadata);

		return {
			id: property.name,
			displayName: property.name,
			...(shape === 'primitive'
				? getSingleValueField(property.edmType, metadata)
				: { type: shape }),
			required: false,
			defaultMatch: false,
			canBeUsedToMatch: false,
			display: true,
		};
	});
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

/**
 * One mapper field per operation parameter. Simple parameters get a field of
 * the matching type, enum parameters a dropdown; complex and collection
 * parameters get a JSON editor (`object`/`array`).
 *
 * No field is marked `required`: the Service Layer's metadata marks no
 * Action or Function parameter as non-nullable, so required-ness cannot be
 * derived, and a missing value is reported by the Service Layer itself.
 */
function getOperationParameterFields(
	parameters: OperationParameter[],
	metadata: ServiceLayerMetadata,
): ResourceMapperField[] {
	return parameters.map((parameter) => {
		const shape = getOperationParameterShape(parameter.edmType, metadata);

		return {
			id: parameter.name,
			displayName: parameter.name,
			...(shape === 'primitive'
				? getSingleValueField(parameter.edmType, metadata)
				: { type: shape }),
			required: false,
			defaultMatch: false,
			canBeUsedToMatch: false,
			display: true,
		};
	});
}

/**
 * Populates the Service Operation `Parameters` resource-mapper field list from
 * the selected unbound Action's or Function's metadata.
 */
export async function getServiceOperationParameters(
	this: ILoadOptionsFunctions,
): Promise<ResourceMapperFields> {
	const operationName = this.getNodeParameter('serviceOperation') as string;

	if (!operationName) {
		return { fields: [] };
	}

	const metadata = await loadServiceLayerMetadata.call(this);
	const operation = metadata.unboundOperations.find(
		(candidate) => candidate.name === operationName,
	);

	if (operation === undefined) {
		return {
			fields: [],
			emptyFieldsNotice: `Unknown service operation "${operationName}".`,
		};
	}

	return toOperationParameterFields(operation, metadata);
}

/**
 * Populates the bound operation `Parameters` resource-mapper field list from
 * the selected entity set's Action or Function. The binding parameter (the
 * entity itself) is never listed; it is addressed through `Key Fields`.
 */
export async function getBoundOperationParameters(
	this: ILoadOptionsFunctions,
): Promise<ResourceMapperFields> {
	const selected = await getSelectedEntityWithMetadata.call(this);

	if (selected === undefined) {
		return { fields: [] };
	}

	const { entity, metadata } = selected;
	const operationName = this.getNodeParameter('boundOperation') as string;

	if (!operationName) {
		return { fields: [] };
	}

	const operation = [...entity.boundActions, ...entity.boundFunctions].find(
		(candidate) => candidate.name === operationName,
	);

	if (operation === undefined) {
		return {
			fields: [],
			emptyFieldsNotice: `Unknown action or function "${operationName}" for entity set "${entity.entitySetName}".`,
		};
	}

	return toOperationParameterFields(operation, metadata);
}

/**
 * An operation whose only parameter is one complex or entity value is
 * expanded: the mapper lists that type's properties, and the request wraps
 * them under the parameter name (see `getExpandedParameter`).
 */
function toOperationParameterFields(
	operation: { name: string; parameters: OperationParameter[] },
	metadata: ServiceLayerMetadata,
): ResourceMapperFields {
	if (operation.parameters.length === 0) {
		return {
			fields: [],
			emptyFieldsNotice: `"${operation.name}" takes no parameters.`,
		};
	}

	const expanded = getExpandedParameter(operation.parameters, metadata);

	return {
		fields:
			expanded === undefined
				? getOperationParameterFields(operation.parameters, metadata)
				: getPropertyFields(expanded.properties, metadata),
	};
}
