# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/2.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Project scaffolded from the n8n community node CLI template (agent docs, CI/publish GitHub Actions workflows, Prettier config, VS Code launch config)
- SAP Business One Service Layer node with light/dark icons, `usableAsTool` support, an operation-based subtitle, and a placeholder `test` operation
- Local HTTPS development tooling (`scripts/setup-local-n8n.mjs`) that resolves the local IPv4 address and generates a self-signed certificate with a matching IP SAN, plus `setup:local`/`dev:local` npm scripts and the `dotenv-cli` dependency, so the Service Layer webhook flow can be developed against `https://` locally
- `package.json` manifest declaring the SAP Business One Service Layer node, pinned dev dependencies, the Node `>=22.22.0` engine requirement, and project metadata (author, description, repository)
- `README.md` documenting the pre-production status, local HTTPS development workflow, planned Service Layer operations and credential fields, compatibility, and the SAP/n8n trademark disclaimer
- `SECURITY.md` with vulnerability reporting instructions, supported versions, and secret-handling guidance
- `CONTRIBUTING.md` documenting the current closed contribution model
- SAP Business One Service Layer API credential (`sapBusinessOneServiceLayerApi`) with base URL, user name, password, company database, and TLS certificate validation fields, a `/Login` connection test that honours the certificate setting, the node's light/dark icons, and registration in `package.json` and on the Service Layer node
