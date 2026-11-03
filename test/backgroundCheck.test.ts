import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	BACKGROUND_CHECK_INTERVAL_MS,
	settleBackgroundChecks,
} from '../nodes/SapBusinessOneServiceLayer/helpers/backgroundCheck';
import { getEntitySetLabels } from '../nodes/SapBusinessOneServiceLayer/helpers/labels';
import {
	getServiceLayerMetadata,
	getServiceLayerMetadataForEditor,
} from '../nodes/SapBusinessOneServiceLayer/helpers/metadata';
import {
	ENTITY_SET_LABELS_ANNOTATED,
	EDMX_V1,
	SYNTHETIC_EDMX_V4,
} from './fixtures/metadataDocuments';
import { createTestCredentials } from './helpers/credentials';
import { createDeferred, createHttpFake, type FakeResponse, type Route } from './helpers/http';
import { createRequestContext, createTestNode } from './helpers/node';

const LOGIN_OK: FakeResponse = {
	statusCode: 200,
	body: { SessionId: 'sess-1', SessionTimeout: 30 },
};

const METADATA_ROUTE = 'GET /$metadata';
const ENTITY_SET_LABELS_ROUTE = 'GET /$metadata?scope=entityset&annotation=label';

const HOUR_MS = 60 * 60 * 1000;

/** The synthetic document with one more entity set, as after a new user table. */
const EDMX_WITH_NEW_TABLE = SYNTHETIC_EDMX_V4.replace(
	'<EntitySet EntityType="SAPB1.Item" Name="Items"/>',
	'<EntitySet EntityType="SAPB1.Item" Name="Items"/>\n        <EntitySet EntityType="SAPB1.Item" Name="U_NEW_TABLE"/>',
);

const LABELS_WITH_NEW_TABLE = ENTITY_SET_LABELS_ANNOTATED.replace(
	'<EntitySet EntityType="SAPB1.Item" Name="Items">',
	'<EntitySet EntityType="SAPB1.Item" Name="U_NEW_TABLE">\n          <Annotation String="New Table" Term="Common.Label"/>\n        </EntitySet>\n        <EntitySet EntityType="SAPB1.Item" Name="Items">',
);

function ok(body: string): FakeResponse {
	return { statusCode: 200, body };
}

/** Freezes `Date.now` at a start time the test moves forward by hand. */
function clock() {
	const start = Date.now();
	const now = vi.spyOn(Date, 'now').mockReturnValue(start);

	return {
		advance: (ms: number) => {
			now.mockReturnValue(start + ms);
		},
	};
}

function scenario(routes: Record<string, Route>) {
	const http = createHttpFake({ 'POST /Login': LOGIN_OK, ...routes });
	const { credentials, credentialId } = createTestCredentials();
	const context = createRequestContext(http, createTestNode(credentialId));

	return {
		http,
		editor: async () =>
			await getServiceLayerMetadataForEditor.call(context, credentials, credentialId),
		run: async () => await getServiceLayerMetadata.call(context, credentials, credentialId),
		labels: async () => await getEntitySetLabels.call(context, credentials, credentialId),
	};
}

afterEach(async () => {
	await settleBackgroundChecks();
	vi.restoreAllMocks();
});

describe('editor metadata', () => {
	it('waits for the first load when nothing is cached', async () => {
		const test = scenario({ [METADATA_ROUTE]: ok(SYNTHETIC_EDMX_V4) });

		const metadata = await test.editor();

		expect(metadata.entities.has('Orders')).toBe(true);
		expect(test.http.countFor(METADATA_ROUTE)).toBe(1);
	});

	it('sends no request while the last check is at most two minutes old', async () => {
		const time = clock();
		const test = scenario({ [METADATA_ROUTE]: ok(SYNTHETIC_EDMX_V4) });

		await test.editor();
		time.advance(BACKGROUND_CHECK_INTERVAL_MS);
		await test.editor();
		await settleBackgroundChecks();

		expect(test.http.countFor(METADATA_ROUTE)).toBe(1);
	});

	it('answers from the cache at once and checks once in the background after two minutes', async () => {
		const time = clock();
		const reload = createDeferred<FakeResponse>();
		const responses = [ok(SYNTHETIC_EDMX_V4)];
		const test = scenario({
			[METADATA_ROUTE]: async () => responses.shift() ?? (await reload.promise),
		});

		const first = await test.editor();
		time.advance(BACKGROUND_CHECK_INTERVAL_MS + 1);
		// The check is still waiting for the Service Layer, yet the list answers.
		const second = await test.editor();
		const third = await test.editor();

		expect(second).toBe(first);
		expect(third).toBe(first);

		reload.resolve(ok(SYNTHETIC_EDMX_V4));
		await settleBackgroundChecks();

		expect(test.http.countFor(METADATA_ROUTE)).toBe(2);
	});

	it('keeps the parsed metadata when the document is unchanged', async () => {
		const time = clock();
		const test = scenario({
			[METADATA_ROUTE]: [ok(SYNTHETIC_EDMX_V4), ok(SYNTHETIC_EDMX_V4)],
		});

		const first = await test.editor();
		time.advance(BACKGROUND_CHECK_INTERVAL_MS + 1);
		await test.editor();
		await settleBackgroundChecks();

		expect(await test.editor()).toBe(first);
	});

	it('shows a new table on the call after the background check', async () => {
		const time = clock();
		const test = scenario({
			[METADATA_ROUTE]: [ok(SYNTHETIC_EDMX_V4), ok(EDMX_WITH_NEW_TABLE)],
		});

		await test.editor();
		time.advance(BACKGROUND_CHECK_INTERVAL_MS + 1);
		const beforeCheck = await test.editor();
		await settleBackgroundChecks();
		const afterCheck = await test.editor();

		expect(beforeCheck.entities.has('U_NEW_TABLE')).toBe(false);
		expect(afterCheck.entities.has('U_NEW_TABLE')).toBe(true);
	});

	it.each([
		['the Service Layer fails', { statusCode: 500, body: { error: { code: -1 } } }],
		['the Service Layer cannot be reached', { rejectWith: new Error('connect ECONNREFUSED') }],
		['the document is the older v1 format', ok(EDMX_V1)],
	])('keeps the cached metadata without an error when %s', async (_case, failure) => {
		const time = clock();
		const responses: Route[] = [ok(SYNTHETIC_EDMX_V4), failure];
		const test = scenario({
			[METADATA_ROUTE]: async () => {
				const response = responses.shift();

				if (response !== undefined && 'rejectWith' in response) {
					throw response.rejectWith;
				}

				return response as FakeResponse;
			},
		});

		const first = await test.editor();
		time.advance(BACKGROUND_CHECK_INTERVAL_MS + 1);
		await test.editor();
		await settleBackgroundChecks();

		expect(await test.editor()).toBe(first);
		expect(test.http.countFor(METADATA_ROUTE)).toBe(2);
	});

	it('retries a failed check only after the next interval', async () => {
		const time = clock();
		const test = scenario({
			[METADATA_ROUTE]: [
				ok(SYNTHETIC_EDMX_V4),
				{ statusCode: 500, body: { error: { code: -1 } } },
				ok(EDMX_WITH_NEW_TABLE),
			],
		});

		await test.editor();
		time.advance(BACKGROUND_CHECK_INTERVAL_MS + 1);
		await test.editor();
		await settleBackgroundChecks();
		await test.editor();
		await settleBackgroundChecks();

		expect(test.http.countFor(METADATA_ROUTE)).toBe(2);

		time.advance(2 * (BACKGROUND_CHECK_INTERVAL_MS + 1));
		await test.editor();
		await settleBackgroundChecks();

		expect(test.http.countFor(METADATA_ROUTE)).toBe(3);
		expect((await test.editor()).entities.has('U_NEW_TABLE')).toBe(true);
	});

	it('shares one background check between concurrent calls', async () => {
		const time = clock();
		const test = scenario({
			[METADATA_ROUTE]: [ok(SYNTHETIC_EDMX_V4), ok(SYNTHETIC_EDMX_V4)],
		});

		await test.editor();
		time.advance(BACKGROUND_CHECK_INTERVAL_MS + 1);
		await Promise.all([test.editor(), test.editor(), test.editor()]);
		await settleBackgroundChecks();

		expect(test.http.countFor(METADATA_ROUTE)).toBe(2);
	});
});

describe('workflow run metadata', () => {
	it('never starts a background check', async () => {
		const time = clock();
		const test = scenario({ [METADATA_ROUTE]: ok(SYNTHETIC_EDMX_V4) });

		await test.run();
		time.advance(BACKGROUND_CHECK_INTERVAL_MS + 1);
		await test.run();
		await settleBackgroundChecks();

		expect(test.http.countFor(METADATA_ROUTE)).toBe(1);
	});

	it('still loads the metadata again once it is older than an hour', async () => {
		const time = clock();
		const test = scenario({
			[METADATA_ROUTE]: [ok(SYNTHETIC_EDMX_V4), ok(EDMX_WITH_NEW_TABLE)],
		});

		await test.run();
		time.advance(HOUR_MS + 1);

		expect((await test.run()).entities.has('U_NEW_TABLE')).toBe(true);
		expect(test.http.countFor(METADATA_ROUTE)).toBe(2);
	});

	it('reads the metadata the editor kept fresh', async () => {
		const time = clock();
		const test = scenario({
			[METADATA_ROUTE]: [ok(SYNTHETIC_EDMX_V4), ok(EDMX_WITH_NEW_TABLE)],
		});

		await test.run();
		time.advance(HOUR_MS - 1);
		await test.editor();
		await settleBackgroundChecks();
		time.advance(HOUR_MS + 1);

		expect((await test.run()).entities.has('U_NEW_TABLE')).toBe(true);
		expect(test.http.countFor(METADATA_ROUTE)).toBe(2);
	});
});

describe('label background check', () => {
	it('answers from the cache and shows a new label after the background check', async () => {
		const time = clock();
		const test = scenario({
			[ENTITY_SET_LABELS_ROUTE]: [ok(ENTITY_SET_LABELS_ANNOTATED), ok(LABELS_WITH_NEW_TABLE)],
		});

		const first = await test.labels();
		time.advance(BACKGROUND_CHECK_INTERVAL_MS + 1);
		const beforeCheck = await test.labels();
		await settleBackgroundChecks();
		const afterCheck = await test.labels();

		expect(beforeCheck).toBe(first);
		expect(beforeCheck.has('U_NEW_TABLE')).toBe(false);
		expect(afterCheck.get('U_NEW_TABLE')).toBe('New Table');
		expect(test.http.countFor(ENTITY_SET_LABELS_ROUTE)).toBe(2);
	});

	it('keeps the parsed labels when the document is unchanged', async () => {
		const time = clock();
		const test = scenario({
			[ENTITY_SET_LABELS_ROUTE]: [ok(ENTITY_SET_LABELS_ANNOTATED), ok(ENTITY_SET_LABELS_ANNOTATED)],
		});

		const first = await test.labels();
		time.advance(BACKGROUND_CHECK_INTERVAL_MS + 1);
		await test.labels();
		await settleBackgroundChecks();

		expect(await test.labels()).toBe(first);
	});

	it('keeps the cached labels when the background check fails', async () => {
		const time = clock();
		const test = scenario({
			[ENTITY_SET_LABELS_ROUTE]: [
				ok(ENTITY_SET_LABELS_ANNOTATED),
				{ statusCode: 500, body: { error: { code: -1 } } },
			],
		});

		const first = await test.labels();
		time.advance(BACKGROUND_CHECK_INTERVAL_MS + 1);
		await test.labels();
		await settleBackgroundChecks();

		expect(await test.labels()).toBe(first);
	});

	it('sends no label request while the last check is at most two minutes old', async () => {
		const time = clock();
		const test = scenario({ [ENTITY_SET_LABELS_ROUTE]: ok(ENTITY_SET_LABELS_ANNOTATED) });

		await test.labels();
		time.advance(BACKGROUND_CHECK_INTERVAL_MS);
		await test.labels();
		await settleBackgroundChecks();

		expect(test.http.countFor(ENTITY_SET_LABELS_ROUTE)).toBe(1);
	});
});
