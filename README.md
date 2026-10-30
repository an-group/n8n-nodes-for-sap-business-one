# n8n Nodes for SAP Business One

Unofficial n8n community nodes for integrating SAP Business One with n8n workflows.

The package is developed and maintained by [ANG Schweiz AG](https://an-group.one/).

The initial node focuses on the SAP Business One Service Layer. Its goal is to simplify authentication, session handling, OData requests, entity operations, error handling, webhook handling, and other recurring integration tasks.

## Project Status

This project is currently under active development.

The current version contains the initial node scaffold and local development tooling. It is not yet ready for production use.

APIs, node parameters, credential structures, operations, and behavior may change before the first stable release.

## Contents

- [Installation](#installation)
- [Development](#development)
- [Testing](#testing)
- [Operations](#operations)
- [Credentials](#credentials)
- [Compatibility](#compatibility)
- [Security](#security)
- [Contributing](#contributing)
- [Resources](#resources)
- [Trademark and Affiliation Notice](#trademark-and-affiliation-notice)
- [License](#license)

## Installation

The package has not yet been published as a stable npm release.

Once published, installation instructions will follow the official [n8n community node installation guide](https://docs.n8n.io/integrations/community-nodes/installation/).

Until then, the project should only be used for development and testing from source.

## Development

Development requires:

- Node.js 24.14.0 or later
- npm
- Git
- OpenSSL
- Access to a local n8n development environment
- Access to an SAP Business One Service Layer instance for integration testing

Clone the repository and install the dependencies:

```bash
git clone https://github.com/an-group/n8n-nodes-for-sap-business-one.git
cd n8n-nodes-for-sap-business-one
npm install
```

The main development commands are:

```bash
npm run build
npm run lint
npm test
npm run typecheck
npm run dev
npm pack --dry-run
```

For Service Layer webhook development, n8n must be reachable through HTTPS. The repository includes the platform-independent setup script:

```text
scripts/setup-local-n8n.mjs
```

It reads the local configuration, determines the configured IPv4 address, creates the `cert/` directory, generates a self-signed certificate, and writes the required n8n settings to `.env.local`.

Create the local configuration from the provided example:

```bash
cp .local-development.example.env .local-development.env
```

PowerShell:

```powershell
Copy-Item .local-development.example.env .local-development.env
```

Adjust `.local-development.env` for your network interface, subnet, IP address, port, and OpenSSL installation.

Then start the local HTTPS development environment:

```bash
npm run dev:local
```

This command prepares the local HTTPS configuration and starts n8n.

To generate only the certificate and `.env.local` without starting n8n, run:

```bash
npm run setup:local
```

The following generated files and directories are local development artifacts and must not be committed:

```text
.env.local
.local-development.env
cert/
```

Self-signed certificates are intended for local development only. Production environments should use a stable hostname and a trusted certificate.

## Testing

The package uses [Vitest](https://vitest.dev/) for unit tests. The suite runs entirely offline: every Service Layer call is answered by an in-process fake, so no SAP Business One instance, network access, or licensed session is needed to run it.

```bash
npm test              # run the suite once
npm run test:watch    # re-run on change
npm run test:coverage # print a text summary and write coverage/lcov.info
npm run typecheck     # type-check the tests against tsconfig.test.json
```

Tests live in `test/` rather than beside the source, so they are never compiled into the published `dist/` build. `npm run typecheck` exists because of that separation: `npm run build` only sees `nodes/` and `credentials/`, and Vitest strips types without checking them, so the test sources would otherwise have no type gate at all.

Coverage output is intentionally limited to a terminal text summary plus `coverage/lcov.info` (no HTML report): `n8n-node build` copies every `**/*.{png,svg}` outside `dist/` and `node_modules/` into the build output, and the HTML reporter emits PNG assets that would then be published.

Covered today: OData literal encoding, simple and composite entity keys, metadata parsing, session reuse and invalidation, concurrent login de-duplication, expired-session retry, Entity Set CRUD request construction, Service Operation and bound Action/Function discovery, parameter handling, and request construction, and Custom API Call endpoint validation, body parsing, and request construction. Live Service Layer integration tests and end-to-end n8n workflow tests are out of scope; verification against a real instance remains manual.

### Writing tests

Test files are linted by the same ESLint configuration as the node source, which is fixed by `"n8n": { "strict": true }` and cannot be relaxed per directory. In practice that means:

- no `try`/`catch` that re-throws — assert failures with `await expect(...).rejects.toThrow(...)`, or capture with `.catch((error: unknown) => error)`
- no `setTimeout`, `setInterval`, `process`, `globalThis`, `__dirname`, or `__filename`
- no `any` — use `unknown` with an explicit cast
- no `console`

Test data must be synthetic. Use the `createTestCredentials()` factory in `test/helpers/credentials.ts` rather than inlining credential values, keep secret-like literals short, and use the reserved `.invalid` TLD for host names. The local `metadata.xml` capture is gitignored and must never be read by a test — the suite uses a small hand-written EDMX fixture in `test/fixtures/` instead. See [SECURITY.md](SECURITY.md).

## Operations

The node exposes a **Resource** selector with three values: **Entity Set**, **Service Operation**, and **Custom API Call**.

**Entity Set** authenticates, fetches and parses the connected instance's Service Layer metadata (`/$metadata`), and lets you pick an entity set (for example `BusinessPartners`, `Orders`, `Items`) from a dynamic, metadata-driven list. Its **Operation** supports:

- **Get** — fetch a single entity by its key
- **Get Many** — fetch a collection, with `Return All`/`Limit`
- **Create** — create an entity
- **Update** — update an entity by its key
- **Delete** — delete an entity by its key
- **Execute Action or Function** — call an Action or Function bound to one entity, for example closing an order (`Orders(45)/Close`)

**Custom API Call** sends a request to any Service Layer endpoint you enter yourself, reusing the credential and session handling described below. See [Custom API Call](#custom-api-call).

**Service Operation** calls an unbound Service Layer Action or Function (for example `CompanyService_GetCompanyInfo`) picked from the connected instance's metadata. See [Service Operation](#service-operation).

The following are planned for later releases:

- `$select`, `$filter`, `$orderby`, and `$expand` query options for Get/Get Many
- Structured SAP Business One error handling
- Webhook and event integration

These are planned and not yet available in the current development version.

### Entity Set operations

- **Key Fields** (Get, Update, Delete, Execute Action or Function) — identifies the entity, one input per key property, populated from the connected instance's metadata and labelled with the property's own name (for example a single `ItemCode` field for `Items`, or `ItemCode`/`CardCode`/`Substitute` for the three-part composite key of `AlternateCatNum`) — no need to know or type a key's name from memory. Every key field is required; leaving one unset is rejected before any request is sent.
- **Fields** (Create, Update) — a metadata-driven field mapper: pick which of the entity type's properties to send, sourced from the connected instance's metadata. Collection properties (for example `Orders.DocumentLines`) are JSON array fields and single complex properties (for example `AddressExtension`) JSON object fields; they are sent as nested JSON, so an order can be created together with its lines. Invalid JSON, or an object where an array is expected (and the reverse), fails with a clear error before any request is sent. Enum fields such as `BoYesNoEnum` are dropdowns listing the enum's members from the metadata; the selected member name (`tYES`) is sent unchanged, and an expression can still supply it. Time-of-day fields (`Edm.TimeOfDay`, for example `DocTime` or `StartTime`) are n8n time fields: a text input the editor checks for `hh:mm` or `hh:mm:ss`; n8n has no time picker. The value is sent unchanged. Verified against a live Service Layer: `08:30` is stored as `08:30:00`, a full timestamp keeps only its time, and a time zone (`10:00:00+01:00`) is ignored, not converted. Other fields keep their type. Fields left empty in the editor are not sent. For Create, the entity's key properties are also offered, since some entity sets require a user-supplied key (`CardCode`) while others assign one automatically (`DocEntry`); for Update, key properties are omitted, since the key is already given via **Key Fields** and the Service Layer does not support changing it through an update.
- **Update and collections** — the Service Layer **merges** a collection sent in an update; it never replaces it. Observed against a live Service Layer instance with `Orders.DocumentLines`:
  - a line with `LineNum` updates that line, and only the properties given
  - lines **without** `LineNum` are matched **by position**: the first entry updates line 0, the second line 1, and so on; only entries beyond the existing lines are appended as new lines. Sending one corrected line without `LineNum` therefore changes line 0, not a new line
  - lines missing from the array stay unchanged, and an empty array (`[]`) changes nothing — lines cannot be removed through Update
  - a single complex property (`AddressExtension`) is merged field by field: sub-fields not sent keep their value

  To replace collections instead, turn on **Replace Collections**. Update then sends the `B1S-ReplaceCollectionsOnPatch: true` request header, and the lines sent replace the existing ones — observed live both with and without other properties in the same update.
- **Get Many** pagination — the Service Layer defaults to 20 rows per page regardless of how many match. `Get Many` requests the page size it actually needs (`Limit`, or unlimited for `Return All`) via the `Prefer: odata.maxpagesize` request header, which normally returns everything in a single request; the server's own pagination (`@odata.nextLink`) is still followed as a fallback if a very large result is nonetheless split across pages.

#### Execute Action or Function

Calls an Action or Function bound to one entity of the selected entity set, identified through **Key Fields** (simple and composite keys).

- **Action or Function** — a metadata-driven list of the operations bound to the selected entity set's entity type, with the kind in the label, for example `Close (Action)` or `List (Function)`. Names such as `Close` exist for many entity types; the list only offers the selected one's own.
- **Parameters** — the operation's parameters, handled exactly as for [Service Operation](#service-operation). Almost every bound operation takes none; the mapper then says so.

Actions are sent as `POST /<EntitySet>(<key>)/<Action>`, with the parameters as a JSON body or no body when there are none. Functions are sent as `GET /<EntitySet>(<key>)/<Function>` without parentheses, with their parameters as query options written as OData literals (`?Name=value`): the Service Layer rejects bound function calls with parentheses.

`SQLQueries` `List` is the exception: its declared `ParamList` parameter is not accepted by the Service Layer under that name. Enter the stored query's own parameters there instead, as `name=value` pairs separated by `&`, with string values in single quotes and quotes inside them doubled — for example `code='C20000'&minTotal=100` for a query declaring `:code` and `:minTotal`. Each pair is sent as a query option of its own. A value containing `&` cannot be expressed this way; use **Custom API Call** for that query.

The output follows the Custom API Call convention.

### Service Operation

Calls an unbound Action or Function from the connected instance's metadata, without building the URL or request body yourself. Requests go through the same authenticated request layer as the other resources.

- **Service Operation** — a metadata-driven list of every unbound Action and Function. The label shows the kind, for example `CompanyService_GetCompanyInfo (Function)` or `QueryService_PostQuery (Action)`; the node picks the HTTP method from it.
- **Parameters** — a metadata-driven field mapper for the selected operation's parameters. Most Actions take exactly one complex or entity parameter, for example `SeriesService_GetDocumentSeries(DocumentTypeParams)` or `…_ApproveAndAdd(Document)`. For these, the mapper lists that type's properties as individual fields, handled like the **Fields** of Create: simple properties get a field of the matching type, enum properties a dropdown of their members, time-of-day properties a time field, nested complex properties a JSON object field and collection properties a JSON array field. The values are sent wrapped under the parameter name, for example `{ "DocumentTypeParams": { "Document": "17" } }` — verified against a live Service Layer. Every other operation gets one field per parameter:
  - simple parameters get a field of the matching type
  - enum parameters get a dropdown of their members
  - time-of-day parameters (`Edm.TimeOfDay`) get a time field
  - complex parameters get a JSON object field
  - collection parameters (`Collection(...)`) get a JSON array field

  To pass a whole structured parameter as one JSON value, for example from an expression, use **Custom API Call**.

  Every parameter is optional, because the Service Layer metadata marks none of them as required; a missing value is reported by the Service Layer itself. Fields left empty are not sent; when every field of an expanded parameter is empty, the Action is sent without a body, which the Service Layer treats like an empty object. Invalid JSON, or JSON of the wrong shape, fails with a clear error before any request is sent. An expression that resolves to an object or array is used as-is.

Actions are sent as `POST /<Action>` with the parameters as a JSON body, or no body when there are none. Functions are sent as `GET /<Function>(Name=value,...)`, with every value written as an OData literal of its declared type (strings quoted and escaped, numbers unquoted); a function without values is called as `/<Function>()`. A function parameter of a complex type cannot be written into the URL and is rejected; no function in the Service Layer metadata declares one.

The output follows the Custom API Call convention below: one output item per input item, object responses unchanged and collections not split, `{ "success": true, "statusCode": 204 }` for an empty response, and any other response under `data`.

### Custom API Call

An escape hatch for Service Layer endpoints the guided operations do not cover yet. Requests go through the same authenticated request layer as the Entity Set operations, so login, `B1SESSION` reuse, expired-session retry, the TLS certificate setting, and error handling behave identically.

- **Method** — `DELETE`, `GET`, `PATCH`, `POST`, or `PUT`.
- **Endpoint** — a path relative to the credential's Base URL; the `/b1s/v2` API root is added automatically and a missing leading slash is added for you. Query parameters go directly into the endpoint. For example:

  ```text
  /Orders(45)
  /Orders?$top=10&$orderby=DocEntry desc
  /Orders(45)/Close
  /CompanyService_GetCompanyInfo()
  ```

  The following are rejected before any request or login is made:
  - absolute or protocol-relative URLs (`https://…`, `//host/…`, or any other `scheme:`), so the session cookie is never sent to another server
  - `..` path segments, including percent-encoded ones, so the call cannot leave the Service Layer API path
  - the `Login` and `Logout` endpoints, because the node manages the session itself — a custom login would put a session ID in the output, and a custom logout would end the session shared by every execution using the credential
- **JSON Body** (`POST`, `PATCH`, `PUT` only) — optional. Leave it empty to send no body. It must be a JSON object or array; invalid JSON fails with a clear error before any request is sent. An expression that resolves to an object is used as-is.
- **Options → Headers** — optional additional HTTP headers as name/value pairs, for example `B1S-ReplaceCollectionsOnPatch: true` for a `PATCH` that replaces a collection. Rows without a name are skipped. The `Cookie` header carries the node's session and cannot be set; an invalid header name, a name given twice (in any letter case), or a value with a line break fails with a clear error before any request is sent.

Each input item produces one output item:

- an object response is returned unchanged — collection responses (`{ "value": [...] }`) are **not** split into separate items and are **not** paginated; follow `@odata.nextLink` yourself if needed
- an empty response (for example `204 No Content` from `PATCH`, `DELETE`, or an action) returns `{ "success": true, "statusCode": 204 }`
- any other response (plain text, XML, or a top-level array) is returned under `data`

Custom headers, a structured query builder, and file/binary uploads are not supported. Response headers are never returned, so session cookies cannot appear in the output.

The node is `usableAsTool`, so an AI agent given this node can issue any of these methods — including `DELETE` — against any Service Layer endpoint the SAP user is authorised for. Scope the SAP user's permissions accordingly.

## Credentials

The SAP Business One Service Layer credential is available to the Service Layer node.

It contains the following fields:

- **Base URL** — Service Layer host and port only, without a path or trailing slash, for example `https://server:50000`. The `/b1s/v2` API path is added automatically; only the Service Layer v2 API (OData V4 metadata) is supported — older v1-only instances are rejected with a clear error rather than silently missing functionality
- **User Name** — SAP Business One user name
- **Password** — SAP Business One user password, stored as a protected n8n credential field
- **Company Database** — company database name, for example `SBODEMOEN`
- **Allow Unauthorized Certificates** — accepts self-signed or otherwise untrusted TLS certificates. Disabled by default and intended only for development environments.

Credentials are stored using the n8n credential system.

The credential test authenticates against the Service Layer `/Login` endpoint using the configured base URL, company database, user name, and password. It honours the `Allow Unauthorized Certificates` setting and reports authentication and connection errors without exposing credential values.

Every credential test opens a real Service Layer session. `/Login` is the only endpoint that can validate these credentials, an n8n credential test cannot chain a `/Logout` call, and SAP Business One sessions stay open until they time out (30 minutes by default) while counting against the licensed session limit. Repeatedly running the credential test against an instance with few available sessions will accumulate open sessions.

### Session handling

The package manages Service Layer sessions internally. It authenticates once per credential, caches the resulting session in memory, and reuses it for subsequent requests.

- The session is created with `POST /Login` and identified by the `B1SESSION` cookie. `ROUTEID` is preserved when the Service Layer returns one, and updated if a later response re-routes the session.
- The server-provided `SessionTimeout` is treated as an idle timeout, measured from the last successful request. No session lifetime is assumed when the Service Layer does not report one; such a session is only discarded once the Service Layer rejects it.
- Concurrent requests using the same credential share a single login instead of opening one licensed session each.
- A session that the Service Layer reports as invalid is discarded, and the failed request is retried once after a new login.
- Editing the credential replaces its cached session rather than leaving a stale one behind.
- Sessions are held per n8n process. In queue mode each worker keeps its own session, so one credential can hold up to one licensed session per worker. Sessions are not persisted across restarts.
- The session is never exposed as a node parameter, a credential field, or node output, and session cookies are kept out of logs and error messages.

Logout handling is not yet implemented. The Entity Set operations, their metadata fetch (below), and Custom API Call all use this session layer.

Passwords, session cookies, and other secrets must not be included in workflow parameters, logs, issues, screenshots, or example data.

### Metadata handling

Selecting the **Entity Set** resource fetches the connected instance's Service Layer metadata (`/$metadata`) over the same session described above, parses it, and caches the result in memory.

- Metadata is cached per Service Layer instance and company database, independently of which SAP user connects — different credentials against the same base URL and company database share one cached copy.
- The cache uses a one-hour time-to-live and collapses concurrent metadata requests into a single fetch.
- Metadata is cached per n8n process, the same limitation described above for sessions: in queue mode, each worker fetches and caches its own copy.
- Only the Service Layer v2 API's OData V4 metadata is supported. Older v1-only instances expose a different, incompatible metadata format — actions and functions don't exist in it at all — and are rejected with a clear error rather than silently returning an entity list with no operations.
- Parsing failures are reported without exposing the raw metadata document, which can be large and contains customer-specific schema details.

## Compatibility

The project is currently tested as a development scaffold.

Production compatibility with specific versions of the following components has not yet been established:

- n8n
- SAP Business One
- SAP Business One Service Layer
- SAP HANA
- Microsoft SQL Server
- Windows
- Linux
- macOS

A supported version matrix will be added before the first stable release.

## Security

Do not report security vulnerabilities through public GitHub issues.

Use the private reporting process described in [SECURITY.md](SECURITY.md).

Never include the following information in issues, discussions, logs, screenshots, or example workflows:

- SAP Business One passwords
- `B1SESSION` cookies
- `ROUTEID` cookies
- n8n credential values
- Internal URLs or hostnames
- Customer data
- Business partner data
- Document or invoice data
- Private certificates or keys

The same rule covers unit tests and their fixtures: see [Writing tests](#writing-tests).

## Contributing

The project currently uses a closed contribution model.

Only authorized maintainers from ANG Schweiz AG may merge changes into the official repository.

External users may:

- Report reproducible bugs
- Request features
- Suggest documentation improvements
- Describe SAP Business One integration use cases
- Report security vulnerabilities privately

External pull requests are not currently accepted.

This contribution model may change in the future. See [CONTRIBUTING.md](CONTRIBUTING.md) for the current policy.

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/community-nodes/)
- [n8n documentation](https://docs.n8n.io/)
- [SAP Business One documentation](https://help.sap.com/docs/SAP_BUSINESS_ONE)
- [Project security policy](SECURITY.md)
- [Contribution guidelines](CONTRIBUTING.md)
- [Changelog](CHANGELOG.md)

## Trademark and Affiliation Notice

This project is an independent, unofficial community integration and is not affiliated with, endorsed by, sponsored by, certified by, or otherwise associated with SAP SE, its affiliates, or n8n GmbH.

SAP, SAP Business One, and SAP Crystal Reports are trademarks or registered trademarks of SAP SE or its affiliates in Germany and other countries.

n8n is a trademark of n8n GmbH.

All other product names, trademarks, and registered trademarks are the property of their respective owners.

References to SAP products and n8n are made solely to describe compatibility and intended use.

No SAP or n8n logos, proprietary artwork, or other brand assets are included in this project.

## License

This project is licensed under the [MIT License](LICENSE).

Copyright © 2026 ANG Schweiz AG.

Project lead and maintainer: Markus Kistler.
