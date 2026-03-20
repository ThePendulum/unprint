'use strict';

const crypto = require('crypto');
const os = require('os');
const WebSocket = require('ws');
const express = require('express');
const expressWs = require('express-ws');
const timers = require('timers/promises');
const { chromium } = require('patchright');
const pidUsage = require('pidusage');
const pidTree = require('pidtree');
const { hri } = require('human-readable-ids');

require('dotenv').config({ quiet: true });

const pkg = require('../package.json');

const memoryLimit = Number(process.env.UNPRINT_MEMORY_LIMIT) || Math.round(Math.max(1024, (os.totalmem() / 1024 / 1024) * 0.3)); // MB, aim for 30% of total available

class HttpError extends Error {
	constructor(message, httpCode) {
		super(message);

		this.name = 'HttpError';
		this.httpCode = httpCode;
	}
}

const logLevels = [
	'error',
	'warn',
	'info',
	'debug',
	'silly',
];

const logLevel = process.env.UNPRINT_LOG_LEVEL || 'info';

function log(level, data, clientId) {
	if (logLevels.indexOf(level) <= logLevels.indexOf(logLevel)) {
		const now = new Date();

		console.log(`${now.toISOString()} [${level.slice(0, 5).padStart(5, ' ')}] ${clientId ? `<${clientId}> ` : ''}${typeof data === 'string' ? data : JSON.stringify(data)}`);
	}
}

const logger = Object.fromEntries(logLevels.map((level) => [level, (...data) => log(level, ...data)]));

function closeSocket(socket, code, reason) {
	const safeCode = code >= 1000 && code <= 1015 && code !== 1006
		? code
		: 1000;

	try {
		socket.close(safeCode, reason);
	} catch (error) {
		// probably already closed
	}
}

async function getClient() {
	const browser = await chromium.launchServer({
		headless: process.env.UNPRINT_HEADLESS !== '0',
	});

	const endpoint = browser.wsEndpoint();

	return {
		browser,
		endpoint,
		active: 0,
		isRetired: false,
	};
}

async function initServer() {
	const app = express();

	const address = process.env.UNPRINT_HOST || '127.0.0.1:3333';
	const [host, portString] = address.split(':');
	const port = portString ? Number(portString) : 3333;

	let client = await getClient();

	async function monitorBrowser() {
		await timers.setTimeout(60_000); // 1 minute

		try {
			const pid = client.browser.process().pid;
			const pids = await pidTree(pid, { root: true });
			const usages = await pidUsage(pids);
			const memoryUsage = Math.round(Object.values(usages).reduce((acc, usage) => acc + usage.memory, 0) / 1024 / 1024); // MB

			if (memoryUsage >= memoryLimit) {
				logger.info(`Cycling browser at ${memoryUsage.toLocaleString()}MB / ${memoryLimit.toLocaleString()}MB`);

				const retiredClient = client;
				retiredClient.isRetired = true;

				try {
					client = await getClient();

					if (retiredClient.active === 0) {
						await retiredClient.browser.close();
					} else {
						// don't await promise timeout to maintain monitor loop pace
						setTimeout(async () => {
							if (retiredClient.active > 0) {
								logger.warn(`Force closing retired browser with ${retiredClient.active} clients`);
								await retiredClient.browser.close();
							}
						}, 300_000); // 5 minutes
					}
				} catch (error) {
					logger.warn(`Failed to retire client: ${error.message}`);

					retiredClient.isRetired = false;
					client = retiredClient;
				}
			} else {
				logger.debug(`Reusing browser at ${memoryUsage.toLocaleString()}MB / ${memoryLimit.toLocaleString()}MB`);
			}
		} catch (error) {
			logger.info(`No browser PID, probably relaunching: ${error.message}`);
		}

		monitorBrowser();
	}

	monitorBrowser();

	expressWs(app);
	app.use(express.json());

	app.use(async (req, _res, next) => {
		if (process.env.UNPRINT_KEY && req.path !== '/') {
			if (!req.headers['unprint-key']) {
				logger.warn(`Unauthenticated request from ${req.ip}`);

				throw new HttpError('Missing key', 401);
			}

			if (process.env.UNPRINT_KEY.length !== req.headers['unprint-key'].length || !crypto.timingSafeEqual(
				Buffer.from(process.env.UNPRINT_KEY, 'utf16le'),
				Buffer.from(req.headers['unprint-key'], 'utf16le'),
			)) {
				logger.warn(`Invalid key from ${req.ip}`);

				throw new HttpError('Invalid key', 401);
			}
		}

		next();
	});

	app.get('/', (_req, res) => {
		res.send(`unprint ${pkg.version}`);
	});

	app.use((error, _req, res, _next) => {
		logger.error(error);

		res.status(error.httpCode || 500).send({
			statusCode: error.httpCode || 500,
			statusMessage: error.message,
		});
	});

	app.ws('/browser', (clientSocket, _req) => {
		const currentClient = client;
		const browserSocket = new WebSocket(currentClient.endpoint);

		const clientId = hri.random();
		let queue = [];

		logger.info('Client connected', clientId);

		currentClient.active += 1;

		clientSocket.on('message', (message) => {
			logger.debug(`Socket data (${browserSocket.readyState === WebSocket.OPEN ? 'sent' : 'queued'}): ${message}`, clientId);

			if (browserSocket.readyState === WebSocket.OPEN) {
				browserSocket.send(message);
			} else {
				queue.push(message);
			}

			try {
				const data = JSON.parse(message);

				if (data.method === 'goto' && data.params) {
					logger.info(`Goto ${data.params.url}`, clientId);
				}
			} catch (error) {
				// no action needed
			}
		});

		browserSocket.on('open', () => {
			logger.debug(`Browser connected, clearing ${queue.length} queue messages`, clientId);

			queue.forEach((message) => browserSocket.send(message));
			queue = [];

			browserSocket.on('message', (message) => {
				if (clientSocket.readyState === WebSocket.OPEN) {
					clientSocket.send(message);
				}
			});
		});

		clientSocket.on('close', async (code, reason) => {
			closeSocket(browserSocket, code, reason);

			currentClient.active -= 1;

			logger.info('Client disconnected', clientId);

			if (currentClient.isRetired && currentClient.active === 0) {
				await currentClient.browser.close();
				logger.info(`Browser retired by ${clientId}`);
			}
		});

		browserSocket.on('close', (code, reason) => {
			closeSocket(clientSocket, code, reason);
			logger.debug('Browser disconnected');
		});

		clientSocket.on('error', (error) => logger.error(`Client error: ${error}`));
		browserSocket.on('error', (error) => logger.error(`Browser error: ${error}`));
	});

	app.listen(port, host, (error) => {
		if (error) {
			logger.error(`Failed to start server: ${error.message}`);
			return;
		}

		logger.info(`unprint server listening on http://${host}:${port}`);
	});
}

initServer();
