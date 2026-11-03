# Development

Notes for the maintainers of this package. External code contributions are not accepted at the moment; see [CONTRIBUTING.md](CONTRIBUTING.md).

## Contents

- [Requirements](#requirements)
- [Setup](#setup)
- [Commands](#commands)
- [Local HTTPS environment](#local-https-environment)
- [Testing](#testing)
- [Writing tests](#writing-tests)

## Requirements

- Node.js 24.14.0 or later
- npm
- Git
- OpenSSL
- Access to a local n8n development environment
- Access to an SAP Business One Service Layer instance for integration testing

## Setup

Clone the repository and install the dependencies:

```bash
git clone https://github.com/an-group/n8n-nodes-for-sap-business-one.git
cd n8n-nodes-for-sap-business-one
npm install
```

## Commands

```bash
npm run build
npm run lint
npm test
npm run typecheck
npm run dev
npm pack --dry-run
```

## Local HTTPS environment

Some local setups need n8n to be reachable through HTTPS, for example when the Service Layer or another system has to call back into n8n. The repository includes a platform-independent setup script:

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

Covered today:

- the node description: the actions in the nodes panel, the Resource Locators, and the OData Expression filter
- OData literal encoding, simple and composite entity keys, and metadata parsing
- session reuse and invalidation, concurrent login de-duplication, and expired-session retry
- the list searches and dropdowns filled from the metadata, and the field mappers
- the SAP labels in those lists: parsing both metadata formats, caching, and the fallback to technical names
- the editor's background check of the cached metadata and labels (`helpers/backgroundCheck.ts`); tests wait for it with `settleBackgroundChecks()` instead of timers
- Entity Set request construction for every operation, including the filter (conditions and OData Expression), `$select`, `$orderby`, and pagination
- Service Operation and bound Action or Function discovery, parameter handling, and request construction
- Custom API Call endpoint validation, body parsing, headers, and request construction
- the credential fields and test request

Live Service Layer integration tests and end-to-end n8n workflow tests are out of scope; verification against a real instance remains manual.

## Writing tests

Test files are linted by the same ESLint configuration as the node source, which is fixed by `"n8n": { "strict": true }` and cannot be relaxed per directory. In practice that means:

- no `try`/`catch` that re-throws — assert failures with `await expect(...).rejects.toThrow(...)`, or capture with `.catch((error: unknown) => error)`
- no `setTimeout`, `setInterval`, `process`, `globalThis`, `__dirname`, or `__filename`
- no `any` — use `unknown` with an explicit cast
- no `console`

Test data must be synthetic. Use the `createTestCredentials()` factory in `test/helpers/credentials.ts` rather than inlining credential values, keep secret-like literals short, and use the reserved `.invalid` TLD for host names. The local `metadata.xml` capture is gitignored and must never be read by a test — the suite uses a small hand-written EDMX fixture in `test/fixtures/` instead. See [SECURITY.md](SECURITY.md).
