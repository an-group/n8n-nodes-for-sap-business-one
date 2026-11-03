import type { ILoadOptionsFunctions, INodePropertyOptions } from 'n8n-workflow';

import { loadServiceLayerMetadata } from '../helpers/credentials';
import {
	getConditionFieldName,
	getConditionOperatorSet,
	getConditionValueKind,
	getEnumMemberNames,
} from '../helpers/filterExpression';
import { getSelectedEntitySetName } from '../helpers/locator';
import { isSingleValueType } from '../helpers/typeClassification';
import type { EntityDefinition, EntityPropertyDefinition } from '../helpers/types';

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
	return await loadSingleValueFields.call(this);
}

/**
 * Populates the `Conditions` field dropdown (`$filter`), with the same fields
 * as `Sort`: only a single primitive or enum value can be compared.
 *
 * Each value carries the field's kind and operator set after a `|`
 * (`DocDate|date|ordered`, `CardType|enum|equality`), the way the Notion node
 * does it: hidden siblings read them to show the matching value input (a
 * dropdown of members for an enum, a date picker for a date) and only the
 * operators that fit (see getConditionOperatorSet). The request uses only the
 * name before the first `|`; the literal's quoting still follows the metadata.
 */
export async function getFilterableFields(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const entity = await loadSelectedEntity.call(this);

	if (entity === undefined) {
		return [];
	}

	const metadata = await loadServiceLayerMetadata.call(this);

	return toFieldOptions(
		entity.properties.filter((property) => isSingleValueType(property.edmType, metadata)),
	).map((option) => {
		const property = entity.properties.find((candidate) => candidate.name === option.value);
		const edmType = property?.edmType ?? '';
		const kind = getConditionValueKind(edmType, metadata);
		const operatorSet = getConditionOperatorSet(edmType, metadata);

		return { ...option, value: `${option.value}|${kind}|${operatorSet}` };
	});
}

/**
 * Populates the `Conditions` value dropdown of an enum field with its members,
 * read from the field chosen in the same condition (`&field`).
 */
export async function getFilterEnumValues(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const entity = await loadSelectedEntity.call(this);
	const field = this.getCurrentNodeParameter('&field');

	if (entity === undefined || typeof field !== 'string') {
		return [];
	}

	const fieldName = getConditionFieldName(field);
	const property = entity.properties.find((candidate) => candidate.name === fieldName);

	if (property === undefined) {
		return [];
	}

	const metadata = await loadServiceLayerMetadata.call(this);

	return getEnumMemberNames(property.edmType, metadata).map((name) => ({ name, value: name }));
}

async function loadSingleValueFields(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const entity = await loadSelectedEntity.call(this);

	if (entity === undefined) {
		return [];
	}

	const metadata = await loadServiceLayerMetadata.call(this);

	return toFieldOptions(
		entity.properties.filter((property) => isSingleValueType(property.edmType, metadata)),
	);
}

async function loadSelectedEntity(
	this: ILoadOptionsFunctions,
): Promise<EntityDefinition | undefined> {
	const entitySetName = getSelectedEntitySetName(this);

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
