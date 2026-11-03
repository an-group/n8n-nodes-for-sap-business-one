import type { ILoadOptionsFunctions, INodePropertyOptions } from 'n8n-workflow';

import { loadPropertyLabels, loadServiceLayerMetadata } from '../helpers/credentials';
import {
	getConditionFieldName,
	getConditionOperatorSet,
	getConditionValueKind,
	getEnumMemberNames,
} from '../helpers/filterExpression';
import { compareLabels, formatLabel, type LabelMap } from '../helpers/labels';
import { getSelectedEntitySetName } from '../helpers/locator';
import { isSingleValueType } from '../helpers/typeClassification';
import type { EntityDefinition, EntityPropertyDefinition } from '../helpers/types';

/**
 * Populates the `Select Field Names or IDs` multi-select (`$select`) with every property of the
 * selected entity set, collections and complex properties included: a live
 * Service Layer accepts `$select=DocEntry,DocumentLines` and returns the lines
 * in full.
 *
 * Every field list shows a field with its SAP label, as `BP Code (CardCode)`,
 * sorted by that text; the value stays the technical name.
 */
export async function getSelectableFields(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const selected = await loadSelectedEntityWithLabels.call(this);

	return selected === undefined ? [] : toFieldOptions(selected.entity.properties, selected.labels);
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
	const selected = await loadSelectedEntityWithLabels.call(this);

	if (selected === undefined) {
		return [];
	}

	const { entity, labels } = selected;
	const metadata = await loadServiceLayerMetadata.call(this);

	return toFieldOptions(
		entity.properties.filter((property) => isSingleValueType(property.edmType, metadata)),
		labels,
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

async function loadSingleValueFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const selected = await loadSelectedEntityWithLabels.call(this);

	if (selected === undefined) {
		return [];
	}

	const metadata = await loadServiceLayerMetadata.call(this);

	return toFieldOptions(
		selected.entity.properties.filter((property) => isSingleValueType(property.edmType, metadata)),
		selected.labels,
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

/**
 * The selected entity set together with its property labels, loaded side by
 * side. Only the field lists need labels; the enum value dropdown does not.
 */
async function loadSelectedEntityWithLabels(
	this: ILoadOptionsFunctions,
): Promise<{ entity: EntityDefinition; labels: LabelMap } | undefined> {
	const entitySetName = getSelectedEntitySetName(this);

	if (!entitySetName) {
		return undefined;
	}

	const [entity, labels] = await Promise.all([
		loadSelectedEntity.call(this),
		loadPropertyLabels.call(this, entitySetName),
	]);

	return entity === undefined ? undefined : { entity, labels };
}

function toFieldOptions(
	properties: EntityPropertyDefinition[],
	labels: LabelMap,
): INodePropertyOptions[] {
	return properties
		.map((property) => ({ name: formatLabel(property.name, labels), value: property.name }))
		.sort((a, b) => compareLabels(a.name, b.name));
}
