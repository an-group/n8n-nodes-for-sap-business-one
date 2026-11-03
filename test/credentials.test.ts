import { describe, expect, it } from 'vitest';

import { SapBusinessOneServiceLayerApi } from '../credentials/SapBusinessOneServiceLayerApi.credentials';

describe('SapBusinessOneServiceLayerApi', () => {
	const credential = new SapBusinessOneServiceLayerApi();
	const declared = credential.properties.map((property) => property.name);

	// The credential test request reads fields through expression strings, which
	// neither TypeScript nor the linter checks. A rename missed there fails
	// quietly: the expression resolves to undefined and the test request simply
	// ignores the field.
	const referenced = [
		...new Set(
			[...JSON.stringify(credential.test ?? {}).matchAll(/\$credentials\.(\w+)/g)].map(
				(match) => match[1],
			),
		),
	];

	it('reads every field the Service Layer login needs', () => {
		expect(referenced).toEqual(
			expect.arrayContaining([
				'baseUrl',
				'companyDb',
				'username',
				'password',
				'skipTlsVerification',
			]),
		);
	});

	it.each(referenced)('declares the %s field its test request reads', (name) => {
		expect(declared).toContain(name);
	});

	it('keeps certificate validation on unless the user opts out', () => {
		const field = credential.properties.find((property) => property.name === 'skipTlsVerification');

		expect(field).toMatchObject({
			displayName: 'Allow Unauthorized Certificates',
			type: 'boolean',
			default: false,
		});
	});

	it('gives examples as placeholders, never in a description', () => {
		for (const property of credential.properties) {
			expect(property.description ?? '', property.name).not.toMatch(/e\.g\./);
		}

		const placeholders = Object.fromEntries(
			credential.properties.map((property) => [property.name, property.placeholder]),
		);
		expect(placeholders).toMatchObject({
			baseUrl: 'e.g. https://myserver.com:50000',
			companyDb: 'e.g. SBODEMOEN',
		});
	});
});
