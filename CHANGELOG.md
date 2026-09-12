# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/2.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Project scaffolded from the n8n community node CLI template (agent docs, CI/publish GitHub Actions workflows, Prettier config, VS Code launch config)
- SAP Business One Service Layer node with light/dark icons, `usableAsTool` support, and a resource-based subtitle
- Local HTTPS development tooling (`scripts/setup-local-n8n.mjs`) that resolves the local IPv4 address and generates a self-signed certificate with a matching IP SAN, plus `setup:local`/`dev:local` npm scripts and the `dotenv-cli` dependency, so the Service Layer webhook flow can be developed against `https://` locally
- `package.json` manifest declaring the SAP Business One Service Layer node, pinned dev dependencies, the Node `>=22.22.0` engine requirement, and project metadata (author, description, repository)
- `README.md` documenting the pre-production status, local HTTPS development workflow, planned Service Layer operations and credential fields, compatibility, and the SAP/n8n trademark disclaimer
- `SECURITY.md` with vulnerability reporting instructions, supported versions, and secret-handling guidance
- `CONTRIBUTING.md` documenting the current closed contribution model
- SAP Business One Service Layer API credential (`sapBusinessOneServiceLayerApi`) with a host-and-port base URL (the `/b1s/v2` Service Layer API path is added automatically), user name, password, company database, and TLS certificate validation fields, a `/Login` connection test that honours the certificate setting, the node's light/dark icons, and registration in `package.json` and on the Service Layer node
- Internal Service Layer session handling (`nodes/SapBusinessOneServiceLayer/helpers/`) that authenticates once per credential via `POST /Login`, caches and reuses the `B1SESSION` session, preserves and refreshes `ROUTEID`, treats the server-provided `SessionTimeout` as an idle timeout without assuming a lifetime of its own, collapses concurrent logins for the same credential onto a single request, discards sessions the Service Layer reports as invalid and retries the failed request once, and keeps passwords, session cookies, and response headers out of node output, logs, and error messages
- Metadata-driven foundation for the Service Layer node: a dependency-free, regex-based parser for the authenticated `/$metadata` (EDMX) endpoint that resolves entity sets to their entity types, simple and composite keys, properties, bound Actions/Functions, and unbound `ActionImport`/`FunctionImport` operations, rejecting metadata from the older, incompatible Service Layer v1 API with a clear error instead of silently omitting actions/functions; an in-memory metadata cache keyed by Service Layer instance and company database (shared across SAP users, one-hour TTL) with single-flight deduplication of concurrent fetches, reusing the existing session/request layer unchanged; a shared OData literal encoder for entity keys and operation parameters; and a `Resource` selector (`Entity Set`, `Service Operation`, `Custom API Call`) with a metadata-driven `Entity Set` dropdown — only `Entity Set` is scaffolded so far, and no operation executes against it yet, replacing the earlier placeholder `test` operation
