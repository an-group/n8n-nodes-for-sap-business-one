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
 * Formats a raw value as an OData V4 literal for the given kind, without URL
 * encoding: a string is wrapped in single quotes with an embedded `'` doubled
 * (`O'Brien` → `'O''Brien'`); numeric and datetime values are trimmed and left
 * bare. The `$filter` builder uses it directly, because the whole filter is
 * encoded once when the query string is built (helpers/queryOptions.ts).
 */
export function formatODataLiteral(rawValue: string, literalKind: OdataLiteralKind): string {
	if (literalKind === 'numeric' || literalKind === 'datetime') {
		return rawValue.trim();
	}

	return `'${rawValue.replace(/'/g, "''")}'`;
}

/**
 * Encodes a raw value as an OData V4 literal for the given kind. Used for both
 * entity key segments and bound/unbound operation parameters; the quoting rule
 * is `formatODataLiteral`'s, so it exists in exactly one place.
 *
 * A string literal is percent-encoded inside its quotes, because the value ends
 * up in a URL path segment. `#` is the clearest case: it starts a URL fragment,
 * so an item code like `A#B` never reaches the server at all — verified against
 * a live instance, which answers "Unrecognized resource path" for the
 * unencoded form and resolves the entity for the encoded one. `?` and `%` break
 * in the same family of ways. A raw `/` turned out to be tolerated by the
 * Service Layer's own routing, but it is still encoded here rather than relying
 * on that.
 *
 * `encodeURIComponent` leaves `'` untouched, so the doubled quote stays literal
 * (`O'Brien` → `'O''Brien'`) — which is the OData escaping form, and legal in a
 * path segment.
 *
 * Numeric and datetime literals are left as-is: their characters are already
 * URL-safe, and percent-encoding a timestamp's separators would risk a case
 * this package cannot verify (no observed entity set has a datetime key).
 */
export function encodeODataLiteral(rawValue: string, literalKind: OdataLiteralKind): string {
	const literal = formatODataLiteral(rawValue, literalKind);

	return literalKind === 'string' ? encodeURIComponent(literal) : literal;
}
