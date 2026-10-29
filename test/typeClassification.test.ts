import { describe, expect, it } from 'vitest';

import { parseMetadataXml } from '../nodes/SapBusinessOneServiceLayer/helpers/metadata';
import { classifyServiceLayerType } from '../nodes/SapBusinessOneServiceLayer/helpers/typeClassification';
import { EDMX_COMPLEX_AND_ENUM_TYPES } from './fixtures/metadataDocuments';

const metadata = parseMetadataXml(EDMX_COMPLEX_AND_ENUM_TYPES);

function classify(edmType: string) {
	return classifyServiceLayerType(edmType, metadata);
}

describe('classifyServiceLayerType', () => {
	it.each([
		['Edm.String', 'primitive', 'Edm.String'],
		['Edm.DateTimeOffset', 'primitive', 'Edm.DateTimeOffset'],
		['SAPB1.BoYesNoEnum', 'enum', 'BoYesNoEnum'],
		['SAPB1.AddressExtension', 'complex', 'AddressExtension'],
		['SAPB1.Order', 'entity', 'Order'],
		['SAPB1.NoSuchType', 'unknown', 'NoSuchType'],
	])('classifies %s as a single %s', (edmType, category, typeName) => {
		expect(classify(edmType)).toEqual({ category, isCollection: false, typeName });
	});

	it.each([
		['Collection(Edm.String)', 'primitive', 'Edm.String'],
		['Collection(SAPB1.BoYesNoEnum)', 'enum', 'BoYesNoEnum'],
		['Collection(SAPB1.DocumentLine)', 'complex', 'DocumentLine'],
		['Collection(SAPB1.Order)', 'entity', 'Order'],
		['Collection(SAPB1.NoSuchType)', 'unknown', 'NoSuchType'],
	])('classifies %s as a collection of %s', (edmType, category, typeName) => {
		expect(classify(edmType)).toEqual({ category, isCollection: true, typeName });
	});

	it('resolves an entity type that no entity set exposes', () => {
		const withoutSet = parseMetadataXml(
			EDMX_COMPLEX_AND_ENUM_TYPES.replace(
				'<EntitySet EntityType="SAPB1.Item" Name="Items"/>',
				'',
			),
		);

		expect(withoutSet.entities.has('Items')).toBe(false);
		expect(classifyServiceLayerType('SAPB1.Item', withoutSet).category).toBe('entity');
	});

	it('looks a name up without its namespace, as the parser stores it', () => {
		expect(classify('Other.AddressExtension')).toEqual({
			category: 'complex',
			isCollection: false,
			typeName: 'AddressExtension',
		});
		expect(classify('AddressExtension').category).toBe('complex');
	});

	it.each(['', 'Collection(', 'Collection()', 'Collection(SAPB1.DocumentLine', 'SAPB1.'])(
		'treats the malformed type reference %j as unknown without throwing',
		(edmType) => {
			expect(classify(edmType).category).toBe('unknown');
		},
	);

	it('marks an empty collection wrapper as a collection', () => {
		expect(classify('Collection()')).toEqual({
			category: 'unknown',
			isCollection: true,
			typeName: '',
		});
	});
});
