#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { networkInterfaces, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = resolve(scriptDirectory, '..');

const configFile = join(projectDirectory, '.local-development.env');
const envFile = join(projectDirectory, '.env.local');
const certificateDirectory = join(projectDirectory, 'cert');

// Environment variables owned by this script. They are always derived from the
// local configuration and cannot be overridden through .local-development.env.
const managedEnvKeys = new Set([
	'N8N_SECURE_COOKIE',
	'N8N_LISTEN_ADDRESS',
	'N8N_HOST',
	'N8N_PORT',
	'N8N_PROTOCOL',
	'N8N_WEBHOOK_URL',
	'N8N_SSL_CERT',
	'N8N_SSL_KEY',
]);

function readEnvFile(filePath) {
	if (!existsSync(filePath)) {
		throw new Error(
			`Configuration file not found: ${filePath}\n` +
				'Copy .local-development.example.env to .local-development.env first.',
		);
	}

	const values = {};

	for (const rawLine of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
		const line = rawLine.trim();

		if (!line || line.startsWith('#')) {
			continue;
		}

		const separatorIndex = line.indexOf('=');

		if (separatorIndex === -1) {
			continue;
		}

		const name = line.slice(0, separatorIndex).trim();
		let value = line.slice(separatorIndex + 1).trim();

		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}

		values[name] = value;
	}

	return values;
}

function getIpv4Addresses() {
	const addresses = [];

	for (const [interfaceName, entries] of Object.entries(networkInterfaces())) {
		for (const entry of entries ?? []) {
			if (entry.family === 'IPv4' && !entry.internal && !entry.address.startsWith('169.254.')) {
				addresses.push({
					interfaceName,
					address: entry.address,
				});
			}
		}
	}

	return addresses;
}

function selectIpAddress(config) {
	const explicitIp = config.LOCAL_N8N_IP;
	const interfaceName = config.LOCAL_N8N_INTERFACE;
	const subnet = config.LOCAL_N8N_SUBNET;

	const addresses = getIpv4Addresses();

	if (explicitIp) {
		const match = addresses.find((entry) => entry.address === explicitIp);

		if (!match) {
			throw new Error(`Configured IP address '${explicitIp}' was not found on this computer.`);
		}

		return match;
	}

	let matches = addresses;

	if (interfaceName) {
		matches = matches.filter(
			(entry) => entry.interfaceName.toLowerCase() === interfaceName.toLowerCase(),
		);
	}

	if (subnet) {
		matches = matches.filter((entry) => entry.address.startsWith(subnet));
	}

	if (matches.length === 1) {
		return matches[0];
	}

	const availableAddresses = addresses
		.map((entry) => `  ${entry.interfaceName}: ${entry.address}`)
		.join('\n');

	if (matches.length === 0) {
		throw new Error(
			'No IPv4 address matches the local development configuration.\n\n' +
				`Available addresses:\n${availableAddresses}`,
		);
	}

	const matchingAddresses = matches
		.map((entry) => `  ${entry.interfaceName}: ${entry.address}`)
		.join('\n');

	throw new Error(
		'Multiple IPv4 addresses match the local development configuration.\n' +
			'Set LOCAL_N8N_IP or make LOCAL_N8N_INTERFACE / LOCAL_N8N_SUBNET more specific.\n\n' +
			`Matching addresses:\n${matchingAddresses}`,
	);
}

function findOpenSsl(configuredPath) {
	const candidates = [];

	if (configuredPath) {
		candidates.push(configuredPath);
	}

	if (platform() === 'win32') {
		candidates.push('C:\\Program Files\\Git\\usr\\bin\\openssl.exe', 'openssl.exe');
	} else {
		candidates.push('openssl');
	}

	for (const candidate of candidates) {
		try {
			execFileSync(candidate, ['version'], {
				stdio: 'ignore',
				windowsHide: true,
			});

			return candidate;
		} catch {
			// Try the next candidate.
		}
	}

	throw new Error('OpenSSL was not found. Install OpenSSL or set LOCAL_N8N_OPENSSL_PATH.');
}

function createCertificate({ openSslPath, ipAddress, certificateFile, keyFile, validityDays }) {
	console.log(`Creating self-signed certificate for ${ipAddress}...`);

	rmSync(certificateFile, { force: true });
	rmSync(keyFile, { force: true });

	execFileSync(
		openSslPath,
		[
			'req',
			'-x509',
			'-newkey',
			'rsa:2048',
			'-sha256',
			'-nodes',
			'-days',
			String(validityDays),
			'-keyout',
			keyFile,
			'-out',
			certificateFile,
			'-subj',
			`/CN=${ipAddress}`,
			'-addext',
			`subjectAltName=IP:${ipAddress}`,
			'-addext',
			'keyUsage=digitalSignature,keyEncipherment',
			'-addext',
			'extendedKeyUsage=serverAuth',
		],
		{
			stdio: 'inherit',
			windowsHide: true,
		},
	);
}

function validatePort(value) {
	const port = Number(value || 5678);

	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new Error(`Invalid LOCAL_N8N_PORT value: '${value}'.`);
	}

	return port;
}

function validateValidityDays(value) {
	const days = Number(value || 365);

	if (!Number.isInteger(days) || days < 1) {
		throw new Error(`Invalid LOCAL_N8N_CERT_VALIDITY_DAYS value: '${value}'.`);
	}

	return days;
}

// Collect additional n8n settings from the local configuration. Every non-empty
// variable starting with N8N_ is passed through, except the managed ones.
function collectAdditionalEnvEntries(config) {
	const entries = [];

	for (const [name, value] of Object.entries(config)) {
		if (!name.startsWith('N8N_') || managedEnvKeys.has(name) || value === '') {
			continue;
		}

		entries.push(`${name}=${value}`);
	}

	return entries.sort();
}

try {
	const config = readEnvFile(configFile);

	const selectedAddress = selectIpAddress(config);
	const ipAddress = selectedAddress.address;
	const port = validatePort(config.LOCAL_N8N_PORT);
	const validityDays = validateValidityDays(config.LOCAL_N8N_CERT_VALIDITY_DAYS);
	const openSslPath = findOpenSsl(config.LOCAL_N8N_OPENSSL_PATH);

	// Create cert directory when it does not exist.
	mkdirSync(certificateDirectory, {
		recursive: true,
	});

	const certificateFile = join(certificateDirectory, `n8n-${ipAddress}.crt`);
	const keyFile = join(certificateDirectory, `n8n-${ipAddress}.key`);

	if (!existsSync(certificateFile) || !existsSync(keyFile)) {
		createCertificate({
			openSslPath,
			ipAddress,
			certificateFile,
			keyFile,
			validityDays,
		});
	} else {
		console.log(`Using existing certificate for ${ipAddress}.`);
	}

	const additionalEnvEntries = collectAdditionalEnvEntries(config);

	const envContent = [
		'# Generated by scripts/setup-local-n8n.mjs',
		'# Do not edit manually.',
		'',
		'N8N_SECURE_COOKIE=true',
		'N8N_LISTEN_ADDRESS=0.0.0.0',
		`N8N_HOST=${ipAddress}`,
		`N8N_PORT=${port}`,
		'N8N_PROTOCOL=https',
		`N8N_WEBHOOK_URL=https://${ipAddress}:${port}/`,
		`N8N_SSL_CERT=${certificateFile}`,
		`N8N_SSL_KEY=${keyFile}`,
		...(additionalEnvEntries.length > 0
			? ['', '# Passed through from .local-development.env', ...additionalEnvEntries]
			: []),
		'',
	].join('\n');

	writeFileSync(envFile, envContent, 'utf8');

	console.log('');
	console.log('Local n8n configuration created successfully.');
	console.log(`Interface:    ${selectedAddress.interfaceName}`);
	console.log(`IP address:   ${ipAddress}`);
	console.log(`Webhook URL:  https://${ipAddress}:${port}/`);
	console.log(`Environment:  ${envFile}`);
	console.log(`Certificate:  ${certificateFile}`);
	console.log(`Private key:  ${keyFile}`);
} catch (error) {
	console.error('');
	console.error(error instanceof Error ? `Error: ${error.message}` : String(error));
	process.exitCode = 1;
}
