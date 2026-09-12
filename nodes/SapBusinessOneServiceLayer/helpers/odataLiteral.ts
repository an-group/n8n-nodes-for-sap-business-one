import type { OdataLiteralKind } from './types';

/**
 * EDM primitive types written as an unquoted, ISO 8601-based OData literal.
 * Kept distinct from `numeric` because their literal format has constraints
 * beyond "don't quote it" that this package has not verified against a real
 * Service Layer instance (no captured schema uses one as a key).
 */
const DATETIME_EDM_TYPES = new Set(['Edm.DateTimeOffset', 'Edm.TimeOfDay', 'Edm.Date', 'Edm.Duration']);

/**
 * Classifies an EDM type for OData literal formatting. `Edm.String` is the
 * only EDM primitive that is quoted; every other EDM primitive (`Int*`,
 * `Decimal`, `Double`, `Single`, `Boolean`, `Guid`, ...) is a bare literal.
 * Non-`Edm.*` types (SAP enum/complex type names such as `SAPB1.BoYesNoEnum`)
 * are treated as opaque strings.
 */
export function classifyEdmType(edmType: string): OdataLiteralKind {
	if (edmType === 'Edm.String') {
		return 'string';
	}

	if (DATETIME_EDM_TYPES.has(edmType)) {
		return 'datetime';
	}

	if (edmType.startsWith('Edm.')) {
		return 'numeric';
	}

	return 'string';
}

/**
 * Encodes a raw value as an OData V4 literal for the given kind. Used for both
 * entity key segments and bound/unbound operation parameters, so the
 * quoting/escaping rule exists in exactly one place.
 */
export function encodeODataLiteral(rawValue: string, literalKind: OdataLiteralKind): string {
	if (literalKind === 'numeric' || literalKind === 'datetime') {
		return rawValue.trim();
	}

	return `'${rawValue.replace(/'/g, "''")}'`;
}
