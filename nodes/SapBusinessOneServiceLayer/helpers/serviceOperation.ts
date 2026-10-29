import type { FunctionsBase, IDataObject } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { getServiceLayerCredentials } from './credentials';
import { toCustomApiCallOutput } from './customApiCall';
import { buildEntityKeySegment } from './entityPath';
import { getServiceLayerMetadata } from './metadata';
import { encodeODataLiteral } from './odataLiteral';
import { serviceLayerApiRequest } from './request';
import { isUnset, parseStructuredValue } from './structuredValue';
import type {
	BoundOperationDefinition,
	EntityDefinition,
	OperationParameter,
	ServiceLayerCredentialContext,
	ServiceLayerCredentials,
	ServiceLayerMetadata,
	UnboundOperationDefinition,
} from './types';

type NodeContext = Pick<FunctionsBase, 'getNode'>;

/**
 * How an operation parameter's value is entered and sent.
 *
 * `primitive` covers `Edm.*` types. Every other non-collection type is treated
 * as a structured `object` entered as JSON. That includes enum types, which the
 * parser cannot tell apart from complex types yet; no unbound operation in the
 * analysed metadata takes an enum parameter.
 */
export type OperationParameterShape = 'primitive' | 'object' | 'array';

export function getOperationParameterShape(edmType: string): OperationParameterShape {
	if (edmType.startsWith('Collection(')) {
		return 'array';
	}

	if (edmType.startsWith('Edm.')) {
		return 'primitive';
	}

	return 'object';
}

/**
 * Collects the values to send, in metadata order. Only parameters the
 * operation declares are read, so a stale mapper entry left behind by a
 * changed schema is never sent. Fields left empty are omitted; the Service
 * Layer reports a missing value itself, since the metadata marks no operation
 * parameter as required.
 */
export function resolveOperationParameterValues(
	context: NodeContext,
	parameters: OperationParameter[],
	mappedValues: IDataObject,
): Array<{ parameter: OperationParameter; value: unknown }> {
	const resolved: Array<{ parameter: OperationParameter; value: unknown }> = [];

	for (const parameter of parameters) {
		const raw = mappedValues[parameter.name];

		if (isUnset(raw)) {
			continue;
		}

		const shape = getOperationParameterShape(parameter.edmType);

		resolved.push({
			parameter,
			value:
				shape === 'primitive'
					? raw
					: parseStructuredValue(
							context,
							{ kind: 'parameter', name: parameter.name, edmType: parameter.edmType },
							shape,
							raw,
						),
		});
	}

	return resolved;
}

/**
 * Builds a function call path with its parameters inline, e.g.
 * `/SBOBobService_GetDueDate(CardCode='C1',RefDate='20260101')`. A function
 * without values is still called with empty parentheses.
 */
export function buildFunctionPath(
	context: NodeContext,
	operationName: string,
	values: Array<{ parameter: OperationParameter; value: unknown }>,
): string {
	const segments = values.map(
		({ parameter, value }) =>
			`${parameter.name}=${encodeFunctionParameter(context, operationName, parameter, value)}`,
	);

	return `/${operationName}(${segments.join(',')})`;
}

/** Encodes one function parameter as an OData literal; only simple types fit in a URL. */
function encodeFunctionParameter(
	context: NodeContext,
	operationName: string,
	parameter: OperationParameter,
	value: unknown,
): string {
	if (getOperationParameterShape(parameter.edmType) !== 'primitive') {
		throw new NodeOperationError(
			context.getNode(),
			`Parameter "${parameter.name}" of function "${operationName}" cannot be sent in the URL`,
			{
				description: `Only simple parameter types can be passed to a function; "${parameter.name}" has the type ${parameter.edmType}. Use the Custom API Call resource for this call.`,
			},
		);
	}

	return encodeODataLiteral(String(value), parameter.literalKind);
}

/**
 * `SQLQueries('...')/List` declares a single `ParamList` string, but the
 * Service Layer rejects it under that name ("Parameter error"). What it
 * accepts is the stored query's own parameters, each as a query option of its
 * own (`?code='C1'`) — verified against a live instance.
 */
function isSqlQueryParameterList(
	operation: BoundOperationDefinition,
	parameter: OperationParameter,
): boolean {
	return (
		operation.bindingEntityType === 'SQLQuery' &&
		operation.name === 'List' &&
		parameter.name === 'ParamList'
	);
}

/**
 * Splits a `ParamList` value such as `code='C1'&minTotal=100` into query
 * options. Values are OData literals written by the user — the types of a
 * stored query's parameters are not in the metadata — and are only
 * percent-encoded here. The name check keeps a system query option such as
 * `$top` from being smuggled in.
 */
function parseSqlQueryParameterList(context: NodeContext, raw: string): string[] {
	return raw
		.split('&')
		.map((pair) => pair.trim())
		.filter((pair) => pair !== '')
		.map((pair) => {
			const match = /^([A-Za-z_]\w*)\s*=([\s\S]*)$/.exec(pair);

			if (match === null) {
				throw new NodeOperationError(
					context.getNode(),
					`The ParamList entry "${pair}" is not in the form name=value`,
					{
						description:
							"Write each parameter of the SQL query as name=value, separated by &, with string values in single quotes, for example code='C20000'&minTotal=100.",
					},
				);
			}

			return `${match[1]}=${encodeURIComponent(match[2].trim())}`;
		});
}

/**
 * Builds a bound function call path. Unlike an unbound function, a bound one
 * is called without parentheses and takes its parameters as query options:
 * the live Service Layer answers "Command Not Found" for
 * `SQLQueries('Q1')/List()` and any inline form, while
 * `IncomingPayments(1)/GetApprovalTemplates` works with or without them.
 */
export function buildBoundFunctionPath(
	context: NodeContext,
	keySegment: string,
	operation: BoundOperationDefinition,
	values: Array<{ parameter: OperationParameter; value: unknown }>,
): string {
	const queryOptions = values.flatMap(({ parameter, value }) =>
		isSqlQueryParameterList(operation, parameter)
			? parseSqlQueryParameterList(context, String(value))
			: [`${parameter.name}=${encodeFunctionParameter(context, operation.name, parameter, value)}`],
	);
	const path = `/${keySegment}/${operation.name}`;

	return queryOptions.length === 0 ? path : `${path}?${queryOptions.join('&')}`;
}

/** An action's parameter values as its JSON body. */
function toActionBody(
	values: Array<{ parameter: OperationParameter; value: unknown }>,
): IDataObject {
	const body: IDataObject = {};

	for (const { parameter, value } of values) {
		body[parameter.name] = value as IDataObject[string];
	}

	return body;
}

/** Looks up an unbound operation by its import name. */
export function findUnboundOperation(
	context: NodeContext,
	metadata: ServiceLayerMetadata,
	operationName: string,
): UnboundOperationDefinition {
	const operation = metadata.unboundOperations.find(
		(candidate) => candidate.name === operationName,
	);

	if (operation === undefined) {
		throw new NodeOperationError(
			context.getNode(),
			`Unknown service operation "${operationName}"`,
			{
				description:
					'The operation is not listed in the Service Layer metadata of the connected instance. Pick it again from the list.',
			},
		);
	}

	return operation;
}

export interface ServiceOperationParameters {
	operationName: string;
	mappedValues: IDataObject;
}

/**
 * Calls an unbound Action (`POST`, parameters as a JSON body) or Function
 * (`GET`, parameters inline in the URL) through the shared authenticated
 * request layer, and shapes the response like a Custom API Call.
 */
export async function executeServiceOperation(
	this: ServiceLayerCredentialContext,
	parameters: ServiceOperationParameters,
	itemIndex: number,
): Promise<IDataObject> {
	const { credentials, credentialId } = await getServiceLayerCredentials.call(this, itemIndex);
	const metadata = await getServiceLayerMetadata.call(this, credentials, credentialId);
	const operation = findUnboundOperation(this, metadata, parameters.operationName);
	const values = resolveOperationParameterValues(
		this,
		operation.parameters,
		parameters.mappedValues,
	);

	if (operation.kind === 'function') {
		const response = await serviceLayerApiRequest.call(this, credentials, credentialId, {
			url: buildFunctionPath(this, operation.name, values),
			method: 'GET',
		});

		return toCustomApiCallOutput(response.body, response.statusCode);
	}

	const response = await serviceLayerApiRequest.call(this, credentials, credentialId, {
		url: `/${operation.name}`,
		method: 'POST',
		...(values.length === 0 ? {} : { body: toActionBody(values) }),
	});

	return toCustomApiCallOutput(response.body, response.statusCode);
}

/** Looks up an Action or Function bound to the entity set's entity type. */
export function findBoundOperation(
	context: NodeContext,
	entity: EntityDefinition,
	operationName: string,
): BoundOperationDefinition {
	const operation = [...entity.boundActions, ...entity.boundFunctions].find(
		(candidate) => candidate.name === operationName,
	);

	if (operation === undefined) {
		throw new NodeOperationError(
			context.getNode(),
			`Unknown action or function "${operationName}" for entity set "${entity.entitySetName}"`,
			{
				description:
					'The Service Layer metadata of the connected instance binds no action or function of that name to this entity set. Pick it again from the list.',
			},
		);
	}

	return operation;
}

export interface BoundOperationParameters {
	operationName: string;
	keyValues: IDataObject;
	mappedValues: IDataObject;
}

/**
 * Calls an Action (`POST`, parameters as a JSON body) or Function (`GET`,
 * parameters as query options) bound to one entity, e.g. `Orders(45)/Close`,
 * and shapes the response like a Custom API Call. The key and the parameters
 * are validated before any request is sent.
 */
export async function executeBoundOperation(
	this: ServiceLayerCredentialContext,
	credentials: ServiceLayerCredentials,
	credentialId: string | null | undefined,
	entity: EntityDefinition,
	parameters: BoundOperationParameters,
): Promise<IDataObject> {
	const operation = findBoundOperation(this, entity, parameters.operationName);
	const keySegment = buildEntityKeySegment(this, entity, parameters.keyValues);
	const values = resolveOperationParameterValues(
		this,
		operation.parameters,
		parameters.mappedValues,
	);

	if (operation.kind === 'function') {
		const response = await serviceLayerApiRequest.call(this, credentials, credentialId, {
			url: buildBoundFunctionPath(this, keySegment, operation, values),
			method: 'GET',
		});

		return toCustomApiCallOutput(response.body, response.statusCode);
	}

	const response = await serviceLayerApiRequest.call(this, credentials, credentialId, {
		url: `/${keySegment}/${operation.name}`,
		method: 'POST',
		...(values.length === 0 ? {} : { body: toActionBody(values) }),
	});

	return toCustomApiCallOutput(response.body, response.statusCode);
}
