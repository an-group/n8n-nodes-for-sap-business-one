import type { FunctionsBase } from 'n8n-workflow';
import { NodeOperationError, jsonParse } from 'n8n-workflow';

type NodeContext = Pick<FunctionsBase, 'getNode'>;

/** The JSON shape a structured mapper field expects. */
export type StructuredShape = 'object' | 'array';

/** What a structured value belongs to, for error messages. */
export interface StructuredValueTarget {
	/** `parameter` for an Action/Function parameter, `field` for an entity property. */
	kind: 'parameter' | 'field';
	name: string;
	edmType: string;
}

/** True when a mapper field was left empty — `0` and `false` are legitimate values. */
export function isUnset(value: unknown): boolean {
	return value === undefined || value === null || value === '';
}

/** Sentinel returned by `jsonParse` on failure, so no catch-and-rethrow is needed. */
const INVALID_JSON = Object.freeze({});

/**
 * Resolves a structured mapper value. The resource mapper delivers the JSON
 * editor's text unparsed (n8n only validates mapper values when a node reads
 * `<parameter>.value`, which this node never does); an expression may already
 * yield an object or array, which is used as-is.
 */
export function parseStructuredValue(
	context: NodeContext,
	target: StructuredValueTarget,
	shape: StructuredShape,
	raw: unknown,
): unknown {
	const expected = shape === 'array' ? 'a JSON array' : 'a JSON object';
	let value = raw;

	if (typeof raw === 'string') {
		value = jsonParse<unknown>(raw, { fallbackValue: INVALID_JSON });

		if (value === INVALID_JSON) {
			throw new NodeOperationError(
				context.getNode(),
				`The value of ${target.kind} "${target.name}" is not valid JSON`,
				{
					description: `"${target.name}" (${target.edmType}) expects ${expected}. Check it for missing quotes or trailing commas.`,
				},
			);
		}
	}

	const matchesShape =
		shape === 'array'
			? Array.isArray(value)
			: typeof value === 'object' && value !== null && !Array.isArray(value);

	if (!matchesShape) {
		throw new NodeOperationError(
			context.getNode(),
			`The value of ${target.kind} "${target.name}" must be ${expected}`,
			{ description: `"${target.name}" has the type ${target.edmType}.` },
		);
	}

	return value;
}
