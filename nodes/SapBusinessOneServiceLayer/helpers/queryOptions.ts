import type { IDataObject } from 'n8n-workflow';

/** One row of the Entity Set `Sort` list. */
interface SortFieldEntry {
	field?: unknown;
	direction?: unknown;
}

/**
 * The fields multi-select arrives as an array from the editor, but an
 * expression may hand over a comma-separated string instead; both are accepted.
 */
function toSelectList(value: unknown): string[] {
	const entries = Array.isArray(value)
		? value.map((entry) => String(entry))
		: typeof value === 'string'
			? value.split(',')
			: [];

	return entries.map((entry) => entry.trim()).filter((entry) => entry !== '');
}

function toOrderByList(value: unknown): string[] {
	const rows = ((value as IDataObject | undefined)?.fields ?? []) as SortFieldEntry[];

	if (!Array.isArray(rows)) {
		return [];
	}

	return rows
		.map((row) => ({
			field: typeof row.field === 'string' ? row.field.trim() : '',
			direction: row.direction === 'desc' ? 'desc' : 'asc',
		}))
		.filter((row) => row.field !== '')
		.map((row) => `${row.field} ${row.direction}`);
}

/**
 * Builds the query string for an Entity Set `Get` or `Get Many` from its
 * field selection, filter, and sort: `$select`, `$filter`, and `$orderby`, in
 * that order. Returns an empty string when nothing is set, so a request
 * without them is unchanged.
 *
 * The string is built here rather than handed to the transport's `qs`, so what
 * reaches the Service Layer is exactly what the unit tests assert. Option names
 * stay literal (`$select`); values are percent-encoded, which a live Service
 * Layer accepts (`%20`, `%2C`) and which keeps `&`, `#`, and `%` inside a
 * filter value from splitting or truncating the URL. `'` is left as is, so
 * OData string literals keep their quotes.
 *
 * `filter` is the finished expression: Get Many builds it from the Conditions
 * and the free-text Filter (see helpers/filterExpression.ts). It is not
 * parsed or validated here; a mistake in the free text surfaces as the
 * Service Layer's own error.
 */
export function buildEntityQueryString(options: IDataObject): string {
	const parameters: string[] = [];

	const select = toSelectList(options.select);

	if (select.length > 0) {
		parameters.push(`$select=${encodeURIComponent(select.join(','))}`);
	}

	const filter = typeof options.filter === 'string' ? options.filter.trim() : '';

	if (filter !== '') {
		parameters.push(`$filter=${encodeURIComponent(filter)}`);
	}

	const orderBy = toOrderByList(options.sort);

	if (orderBy.length > 0) {
		parameters.push(`$orderby=${encodeURIComponent(orderBy.join(','))}`);
	}

	return parameters.length === 0 ? '' : `?${parameters.join('&')}`;
}
