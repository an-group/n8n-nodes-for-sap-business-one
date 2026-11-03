import type { ILoadOptionsFunctions } from 'n8n-workflow';

/**
 * Reads a Resource Locator parameter (Entity Set, Action or Function, Service
 * Operation) as its plain value, whichever mode the user picked. n8n's
 * `extractValue` also passes a plain string through unchanged.
 */
export function getLocatorValue(context: ILoadOptionsFunctions, parameterName: string): string {
	const value = context.getNodeParameter(parameterName, '', { extractValue: true });

	return typeof value === 'string' ? value : '';
}

/** The entity set chosen in the Entity Set locator, or `''` while none is chosen. */
export function getSelectedEntitySetName(context: ILoadOptionsFunctions): string {
	return getLocatorValue(context, 'entitySet');
}
