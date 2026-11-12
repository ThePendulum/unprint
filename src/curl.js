import { spawn } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { buffer as consumeBuffer } from 'node:stream/consumers';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// curl config file string, see 'curl --help config'; CR/LF are never valid in URLs or header values, strip them to prevent injecting options
function quote(value) {
	return `"${String(value)
		.replace(/[\\"]/g, '\\$&')
		.replace(/\t/g, '\\t')
		.replace(/[\r\n]/g, '')}"`;
}

function option(name, value) {
	return value === undefined ? name : `${name} = ${quote(value)}`;
}

// files are only readable by the current user, the directory is removed when curl exits
async function createTempFiles() {
	let dir = null;

	return {
		async write(name, data) {
			dir ??= await fsp.mkdtemp(path.join(os.tmpdir(), 'unprint-curl-'));

			const filePath = path.join(dir, name);

			if (typeof data === 'string' || ArrayBuffer.isView(data)) {
				await fsp.writeFile(filePath, data, { mode: 0o600 });
			} else if (data instanceof ArrayBuffer) {
				await fsp.writeFile(filePath, Buffer.from(data), { mode: 0o600 });
			} else if (data instanceof URLSearchParams) {
				await fsp.writeFile(filePath, data.toString(), { mode: 0o600 });
			} else if (typeof Blob !== 'undefined' && data instanceof Blob) {
				await fsp.writeFile(filePath, Buffer.from(await data.arrayBuffer()), { mode: 0o600 });
			} else if (data?.[Symbol.asyncIterator]) { // readable streams and async iterables
				await pipeline(data, fs.createWriteStream(filePath, { mode: 0o600 }));
			} else {
				throw new Error(`Unsupported request body type for curl interface: ${data?.constructor?.name || typeof data}`);
			}

			return filePath;
		},
		async remove() {
			if (dir) {
				await fsp.rm(dir, { recursive: true, force: true });
			}
		},
	};
}

const tlsVersions = {
	TLSv1: '1.0',
	'TLSv1.1': '1.1',
	'TLSv1.2': '1.2',
	'TLSv1.3': '1.3',
};

const supportedTlsOptions = ['rejectUnauthorized', 'ca', 'cert', 'key', 'passphrase', 'minVersion', 'maxVersion', 'ciphers'];

// translate the Node TLS options unprint accepts for undici to their curl equivalents, PEM contents are written to temp files
async function getTlsOptions(tls, tempFiles) {
	if (!tls) {
		return [];
	}

	const unsupported = Object.keys(tls).filter((key) => !supportedTlsOptions.includes(key));

	if (unsupported.length > 0) {
		throw new Error(`Unsupported TLS options for curl interface: ${unsupported.join(', ')}`);
	}

	const pem = (value) => [].concat(value).map(String).join('\n');
	const lines = [];

	if (tls.rejectUnauthorized === false) lines.push(option('insecure'));
	if (tls.ca) lines.push(option('cacert', await tempFiles.write('ca.pem', pem(tls.ca))));
	if (tls.cert) lines.push(option('cert', await tempFiles.write('cert.pem', pem(tls.cert))));
	if (tls.key) lines.push(option('key', await tempFiles.write('key.pem', pem(tls.key))));
	if (tls.passphrase) lines.push(option('pass', tls.passphrase));
	if (tls.minVersion) lines.push(option(`tlsv${tlsVersions[tls.minVersion] || tls.minVersion}`));
	if (tls.maxVersion) lines.push(option('tls-max', tlsVersions[tls.maxVersion] || tls.maxVersion));
	if (tls.ciphers) lines.push(option('ciphers', tls.ciphers));

	return lines;
}

function getHeaderOptions(headers, hasBody) {
	const lines = [];
	const sent = new Set();

	Object.entries(headers || {}).forEach(([key, value]) => {
		if (value === null || value === undefined) {
			return;
		}

		[].concat(value).forEach((headerValue) => {
			// 'Name:' would make curl remove the header, 'Name;' sends it empty
			lines.push(option('header', headerValue === '' ? `${key};` : `${key}: ${headerValue}`));
		});

		sent.add(key.toLowerCase());
	});

	// curl adds these by itself, unlike undici: remove them unless set explicitly
	if (!sent.has('user-agent')) lines.push(option('header', 'User-Agent:'));
	if (hasBody && !sent.has('content-type')) lines.push(option('header', 'Content-Type:')); // would default to urlencoded
	if (hasBody && !sent.has('expect')) lines.push(option('header', 'Expect:')); // 100-continue for large bodies

	return lines;
}

function parseHeaderBlock(block) {
	const [statusLine, ...lines] = block.split(/\r?\n/);
	const status = statusLine.match(/^HTTP\/([\d.]+) (\d{3})(?: (.*))?$/);

	if (!status) {
		return null;
	}

	const headers = {};

	lines.forEach((line) => {
		const separator = line.indexOf(':');

		if (separator <= 0) {
			return;
		}

		const key = line.slice(0, separator).trim().toLowerCase();
		const value = line.slice(separator + 1).trim();

		// mirror undici: repeated headers become arrays
		if (Object.hasOwn(headers, key)) {
			headers[key] = [].concat(headers[key], value);
		} else {
			headers[key] = value;
		}
	});

	return {
		httpVersion: status[1],
		statusCode: Number(status[2]),
		statusText: status[3] || '',
		headers,
	};
}

function getBlockEnd(buffer) {
	const crlf = buffer.indexOf('\r\n\r\n');

	if (crlf > -1) {
		return { end: crlf, length: 4 };
	}

	const lf = buffer.indexOf('\n\n');

	return lf > -1 ? { end: lf, length: 2 } : null;
}

function createBody(child) {
	const body = new PassThrough();

	// discard the remaining body and stop the transfer
	async function dump() {
		body.destroy();

		if (child.exitCode === null && child.signalCode === null) {
			child.kill();
		}
	}

	return Object.assign(body, {
		text: async () => (await consumeBuffer(body)).toString('utf8'),
		json: async () => JSON.parse((await consumeBuffer(body)).toString('utf8')),
		arrayBuffer: async () => {
			const data = await consumeBuffer(body);

			return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
		},
		dump,
		cancel: dump,
	});
}

/**
 * Make a request with the curl binary, resolving with an object resembling undici's request() response
 * once the response headers are received: { statusCode, statusText, headers, body, httpVersion }
 */
async function curlRequest(url, {
	method = 'GET',
	headers,
	body,
	proxy,
	timeout,
	tls,
	signal,
	curlPath = 'curl',
	curlArgs = [],
} = {}) {
	signal?.throwIfAborted();

	const tempFiles = await createTempFiles();
	const isHead = method === 'HEAD';
	const hasBody = body !== null && body !== undefined && !isHead;

	let config;

	try {
		config = [
			option('url', url),
			option('globoff'), // don't interpret [] and {} in the URL
			option('silent'),
			option('suppress-connect-headers'), // don't output proxy CONNECT responses before the actual headers
			option('write-out', '%{stderr}%{errormsg}'),
			option('proxy', proxy || ''), // empty explicitly disables proxy environment variables, like undici
			...(isHead
				? [option('head')] // -X HEAD would wait for a body, -I writes the headers to stdout itself
				: [option('dump-header', '-'), option('output', '-')]),
			...(!isHead && method !== 'GET' ? [option('request', method)] : []),
			...(hasBody ? [option('data-binary', `@${await tempFiles.write('body', body)}`)] : []),
			...(timeout ? [
				option('connect-timeout', timeout / 1000),
				// like undici's bodyTimeout, abort when no data was received for the timeout duration, rather than limiting total time
				option('speed-limit', 1),
				option('speed-time', Math.max(1, Math.ceil(timeout / 1000))),
			] : []),
			...await getTlsOptions(tls, tempFiles),
			...getHeaderOptions(headers, hasBody),
		].join('\n');
	} catch (error) {
		await tempFiles.remove();
		throw error;
	}

	return new Promise((resolve, reject) => {
		// -q skips .curlrc, it must be the first argument; options are passed through stdin so headers and cookies don't show up in the process list
		const child = spawn(curlPath, ['-q', '--config', '-', ...curlArgs], {
			stdio: ['pipe', 'pipe', 'pipe'],
			signal,
			windowsHide: true,
		});

		const responseBody = createBody(child);

		let response = null;
		let pending = Buffer.alloc(0);
		let stderr = '';
		let spawnError = null;

		function onHeaderData(chunk) {
			pending = Buffer.concat([pending, chunk]);

			let blockEnd = getBlockEnd(pending);

			while (blockEnd) {
				const block = parseHeaderBlock(pending.subarray(0, blockEnd.end).toString('latin1'));

				pending = pending.subarray(blockEnd.end + blockEnd.length);

				if (!block) {
					child.stdout.off('data', onHeaderData);
					child.kill();
					reject(new Error('Failed to parse curl response headers'));

					return;
				}

				// skip informational responses such as 100 Continue and 103 Early Hints
				if (block.statusCode >= 200 || block.statusCode < 100) {
					child.stdout.off('data', onHeaderData);
					child.stdout.pause();

					response = { ...block, body: responseBody };

					if (pending.length > 0) {
						responseBody.write(pending);
					}

					// ended on process close, so a failed transfer can be reported as an error instead of a truncated body
					child.stdout.pipe(responseBody, { end: false });

					resolve(response);

					return;
				}

				blockEnd = getBlockEnd(pending);
			}
		}

		child.stdout.on('data', onHeaderData);
		child.stderr.on('data', (chunk) => { stderr += chunk; });
		child.stdin.on('error', () => {}); // curl may exit before reading all of its config, reported on close instead

		child.on('error', (error) => {
			spawnError = error.code === 'ENOENT'
				? new Error(`curl binary not found at '${curlPath}', install curl or configure curlPath`)
				: error;
		});

		child.on('close', async (code, exitSignal) => {
			await tempFiles.remove().catch(() => {});

			const error = spawnError
				|| (code !== 0 && new Error(stderr.trim() || (exitSignal ? `curl was terminated (${exitSignal})` : `curl exited with code ${code}`)));

			if (!response) {
				reject(error || new Error('curl exited without a response'));

				return;
			}

			if (responseBody.destroyed) {
				return;
			}

			if (error) {
				responseBody.destroy(error);
			} else {
				responseBody.end();
			}
		});

		child.stdin.end(config);
	});
}

export default curlRequest;
