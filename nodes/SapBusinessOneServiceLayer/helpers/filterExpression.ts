import type { FunctionsBase, IDataObject } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import type { TypeRegistry } from './entityBody';
import { classifyEdmType, formatODataLiteral } from './odataLiteral';
import { isUnset } from './structuredValue';
import { classifyServiceLayerType, isSingleValueType } from './typeClassification';
import type { EntityDefinition, EntityPropertyDefinition } from './types';

type NodeContext = Pick<FunctionsBase, 'getNode'>;

/** The parameters of a Get Many request that make up its `$filter`. */
export interface FilterInput {
	/** `Filter`: `none`, `manual` (the Conditions) or `odata` (the OData Expression). */
	filterType: unknown;
	/** The `Conditions` fixed collection, read for `manual`. */
	conditions?: unknown;
	/** `Must Match`: `and` or `or`, read for `manual`. */
	matchType?: unknown;
	/** `OData Expression`, sent as entered, read for `odata`. */
	odataFilter?: unknown;
}

/**
 * One row of the `Conditions` list. The value is entered in one of three
 * inputs, depending on the field's kind (see `getConditionValueKind`).
 */
interface ConditionEntry {
	field?: unknown;
	operator?: unknown;
	comparisonOperator?: unknown;
	equalityOperator?: unknown;
	value?: unknown;
	enumValue?: unknown;
	dateValue?: unknown;
}

/**
 * Which value input a condition shows for a field: a dropdown of members for
 * an enum (flags enums excepted, since their value may combine members), a
 * date picker for a date, and a text input for everything else.
 */
export type ConditionValueKind = 'enum' | 'date' | 'text';

const DATE_EDM_TYPES = new Set(['Edm.DateTimeOffset', 'Edm.Date']);

/** The member names of a non-flags enum type, or none for any other type. */
export function getEnumMemberNames(edmType: string, metadata: TypeRegistry): string[] {
	const typeInfo = classifyServiceLayerType(edmType, metadata);
	const enumType =
		typeInfo.category === 'enum' ? metadata.enumTypes.get(typeInfo.typeName) : undefined;

	return enumType === undefined || enumType.isFlags
		? []
		: enumType.members.map((member) => member.name);
}

export function getConditionValueKind(edmType: string, metadata: TypeRegistry): ConditionValueKind {
	if (getEnumMemberNames(edmType, metadata).length > 0) {
		return 'enum';
	}

	return DATE_EDM_TYPES.has(edmType) ? 'date' : 'text';
}

/**
 * Which operators a condition offers for a field, the way n8n's Data Table
 * node offers only the conditions that fit a column: all of them for a string
 * (`text`); the comparisons without the string functions for a number, date
 * or time (`ordered`); only Equal, Not Equal and the empty checks for an enum,
 * a boolean and any other value (`equality`). On an enum the string functions
 * silently match nothing.
 */
export type ConditionOperatorSet = 'text' | 'ordered' | 'equality';

export function getConditionOperatorSet(
	edmType: string,
	metadata: TypeRegistry,
): ConditionOperatorSet {
	if (classifyServiceLayerType(edmType, metadata).category === 'enum') {
		return 'equality';
	}

	if (edmType === 'Edm.String') {
		return 'text';
	}

	return NUMERIC_EDM_TYPES.has(edmType) || DATE_EDM_TYPES.has(edmType) || edmType === 'Edm.TimeOfDay'
		? 'ordered'
		: 'equality';
}

/**
 * The operator of a condition, read from the input the editor showed. The
 * field's value carries the operator set (`DocDate|date|ordered`); a field
 * given by expression comes without it, and the editor then shows the input
 * with all operators.
 */
function getConditionOperator(row: ConditionEntry): string {
	const set = typeof row.field === 'string' ? row.field.split('|')[2]?.trim() : undefined;
	const operator =
		set === 'ordered'
			? row.comparisonOperator
			: set === 'equality'
				? row.equalityOperator
				: row.operator;

	return typeof operator === 'string' && operator !== '' ? operator : 'equal';
}

/**
 * The property name of a condition's field. The dropdown stores the kind after
 * a `|` (`DocDate|date`); a name given by expression may come without it.
 */
export function getConditionFieldName(field: string): string {
	return field.split('|')[0].trim();
}

/**
 * The value of a condition, read from the input its field's kind shows. The
 * other inputs may still hold a value from a field chosen earlier, so the kind
 * comes from the metadata rather than from the stored row. An expression that
 * fills the plain `Value` instead is accepted for every kind.
 */
function getConditionValue(row: ConditionEntry, kind: ConditionValueKind): unknown {
	const typed = kind === 'enum' ? row.enumValue : kind === 'date' ? row.dateValue : undefined;

	return isUnset(typed) ? (row.value ?? '') : typed;
}

const COMPARISON_OPERATORS: Record<string, string> = {
	equal: 'eq',
	notEqual: 'ne',
	greaterThan: 'gt',
	greaterOrEqual: 'ge',
	lessThan: 'lt',
	lessOrEqual: 'le',
};

const STRING_FUNCTIONS: Record<string, { name: string; negated: boolean }> = {
	contains: { name: 'contains', negated: false },
	notContains: { name: 'contains', negated: true },
	startsWith: { name: 'startswith', negated: false },
	notStartsWith: { name: 'startswith', negated: true },
	endsWith: { name: 'endswith', negated: false },
	notEndsWith: { name: 'endswith', negated: true },
};

const NULL_OPERATORS: Record<string, string> = {
	isEmpty: 'eq null',
	isNotEmpty: 'ne null',
};

/** EDM types whose literal is a bare number. */
const NUMERIC_EDM_TYPES = new Set([
	'Edm.Byte',
	'Edm.SByte',
	'Edm.Int16',
	'Edm.Int32',
	'Edm.Int64',
	'Edm.Decimal',
	'Edm.Double',
	'Edm.Single',
]);

/** A plain decimal number, sent as typed so no precision is lost. */
const PLAIN_NUMBER_PATTERN = /^-?\d+(\.\d+)?$/;

/** Any number JavaScript can read, exponent notation included. */
const NUMBER_PATTERN = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/**
 * Writes a number without exponent notation, which the Service Layer rejects
 * (`1.5e3` → 400). `String()` switches to it from 1e21 and below 1e-6.
 */
function toPlainNumber(value: number): string {
	const text = String(value);

	return /e/i.test(text)
		? value.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 20 })
		: text;
}

function formatNumber(raw: unknown): string | undefined {
	if (typeof raw === 'number') {
		return Number.isFinite(raw) ? toPlainNumber(raw) : undefined;
	}

	if (typeof raw !== 'string') {
		return undefined;
	}

	const text = raw.trim();

	if (PLAIN_NUMBER_PATTERN.test(text)) {
		return text;
	}

	return NUMBER_PATTERN.test(text) ? toPlainNumber(Number(text)) : undefined;
}

/**
 * The text of a date, time or string value. A `dateTime` field of the
 * resource mapper arrives as a Luxon `DateTime`, an expression may yield a JS
 * `Date`; both are written as ISO 8601.
 */
function toText(raw: unknown): string {
	if (raw instanceof Date) {
		return raw.toISOString();
	}

	if (typeof raw === 'object' && raw !== null) {
		const toISO = (raw as { toISO?: unknown }).toISO;

		if (typeof toISO === 'function') {
			return String(toISO.call(raw));
		}
	}

	return String(raw);
}

/**
 * Formats a value as the literal for the given property, by its metadata type
 * and never by the look of the value: a numeric-looking `CardCode` such as
 * `10001` stays quoted, and `DocTotal gt '1000'` would be rejected ("is not a
 * NUMBER").
 *
 * Strings, enum members, dates and times are quoted; the Service Layer
 * rejects an unquoted enum member and an unquoted date with an offset, and
 * accepts every quoted date and time form. Numbers are bare, booleans
 * `true`/`false`.
 */
function formatFilterValue(
	context: NodeContext,
	property: EntityPropertyDefinition,
	raw: unknown,
	origin: string,
): string {
	if (NUMERIC_EDM_TYPES.has(property.edmType)) {
		const number = formatNumber(raw);

		if (number === undefined) {
			throw new NodeOperationError(
				context.getNode(),
				`${origin} needs a number, got "${toText(raw)}"`,
				{
					description: `${property.name} is a number property (${property.edmType}). Enter the number without quotes or thousands separators, e.g. 1000 or 12.5.`,
				},
			);
		}

		return number;
	}

	if (property.edmType === 'Edm.Boolean') {
		const text = toText(raw).trim().toLowerCase();

		if (text !== 'true' && text !== 'false') {
			throw new NodeOperationError(
				context.getNode(),
				`${origin} needs true or false, got "${toText(raw)}"`,
			);
		}

		return text;
	}

	if (classifyEdmType(property.edmType) === 'numeric') {
		// Other EDM primitives (Guid, ...) are bare literals as well.
		return formatODataLiteral(toText(raw), 'numeric');
	}

	const text = classifyEdmType(property.edmType) === 'datetime' ? toText(raw).trim() : toText(raw);

	return formatODataLiteral(text, 'string');
}

/**
 * Resolves a field name to a property of the entity that can be compared:
 * one primitive or enum value. A name typed in an expression can be anything,
 * so an unknown or structured property is rejected here rather than reported
 * as a Service Layer error.
 */
function resolveProperty(
	context: NodeContext,
	entity: EntityDefinition,
	metadata: TypeRegistry,
	fieldName: string,
	origin: string,
): EntityPropertyDefinition {
	const property = entity.properties.find((candidate) => candidate.name === fieldName);

	if (property === undefined) {
		throw new NodeOperationError(
			context.getNode(),
			`${origin}: "${fieldName}" is not a field of "${entity.entitySetName}"`,
		);
	}

	if (!isSingleValueType(property.edmType, metadata)) {
		throw new NodeOperationError(
			context.getNode(),
			`${origin}: "${fieldName}" cannot be filtered on`,
			{
				description: `Only fields holding a single value can be filtered on. Collections and structured fields such as DocumentLines need the 'OData Expression' filter.`,
			},
		);
	}

	return property;
}

function buildCondition(
	context: NodeContext,
	entity: EntityDefinition,
	metadata: TypeRegistry,
	row: ConditionEntry,
	position: number,
): string {
	const fieldName = typeof row.field === 'string' ? getConditionFieldName(row.field) : '';
	const operator = getConditionOperator(row);

	if (fieldName === '') {
		throw new NodeOperationError(context.getNode(), `Condition ${position} has no field`);
	}

	const origin = `Condition ${position} ("${fieldName}")`;
	const property = resolveProperty(context, entity, metadata, fieldName, origin);
	const value = getConditionValue(row, getConditionValueKind(property.edmType, metadata));

	if (operator in NULL_OPERATORS) {
		return `${property.name} ${NULL_OPERATORS[operator]}`;
	}

	if (operator in COMPARISON_OPERATORS) {
		return `${property.name} ${COMPARISON_OPERATORS[operator]} ${formatFilterValue(context, property, value, origin)}`;
	}

	const stringFunction = STRING_FUNCTIONS[operator];

	if (stringFunction === undefined) {
		throw new NodeOperationError(context.getNode(), `${origin}: unknown operator "${operator}"`);
	}

	// Verified live: on an enum property the string functions do not fail, they
	// silently match nothing.
	if (classifyServiceLayerType(property.edmType, metadata).category === 'enum') {
		throw new NodeOperationError(
			context.getNode(),
			`${origin}: 'Contains', 'Starts With' and 'Ends With' do not work on a dropdown (enum) field`,
			{ description: "Use 'Equal' or 'Not Equal' with one of its values instead." },
		);
	}

	// The searched text is always a string, also on a number property.
	const call = `${stringFunction.name}(${property.name},${formatODataLiteral(toText(value), 'string')})`;

	return stringFunction.negated ? `not ${call}` : call;
}

/** `Conditions`, combined with the one `Must Match` operator. */
function buildConditions(
	context: NodeContext,
	entity: EntityDefinition,
	metadata: TypeRegistry,
	conditions: unknown,
	matchType: unknown,
): string {
	const rows = ((conditions as IDataObject | undefined)?.condition ?? []) as ConditionEntry[];

	if (!Array.isArray(rows)) {
		return '';
	}

	const joiner = matchType === 'or' ? ' or ' : ' and ';

	return rows
		.map((row, index) => buildCondition(context, entity, metadata, row, index + 1))
		.join(joiner);
}

/**
 * Builds the `$filter` of a Get Many request. `Filter` picks one source: the
 * `Conditions` (`manual`), joined by `Must Match`, or the `OData Expression`
 * text (`odata`), sent as entered. The two are never combined, so an input
 * left over from switching modes, hidden in the editor, is not sent. `none`
 * and an unknown mode send no filter.
 *
 * The result is not URL-encoded; `buildEntityQueryString` encodes the whole
 * filter once. Returns an empty string when nothing is set.
 */
export function buildFilterExpression(
	context: NodeContext,
	entity: EntityDefinition,
	metadata: TypeRegistry,
	input: FilterInput,
): string {
	if (input.filterType === 'manual') {
		return buildConditions(context, entity, metadata, input.conditions, input.matchType);
	}

	if (input.filterType === 'odata') {
		return typeof input.odataFilter === 'string' ? input.odataFilter.trim() : '';
	}

	return '';
}
