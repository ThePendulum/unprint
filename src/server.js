'use strict';

const crypto = require('crypto');
const WebSocket = require('ws');
const express = require('express');
const expressWs = require('express-ws');
// const timers = require('timers/promises');
const { chromium } = require('patchright');

require('dotenv').config();

const pkg = require('../package.json');

class HttpError extends Error {
	constructor(message, httpCode, friendlyMessage, data) {
		super(message);

		this.name = 'HttpError';
		this.httpCode = httpCode;

		if (friendlyMessage) {
			this.friendlyMessage = friendlyMessage;
		}

		if (data) {
			this.data = data;
		}
	}
}

function log(level, ...data) {
	const now = new Date();

	console.log(`${now.toISOString()} [${level.slice(0, 5).padStart(5, ' ')}] ${data.join(' ')}`);
}

const logger = Object.fromEntries([
	'info',
	'debug',
	'silly',
	'error',
	'warn',
].map((level) => [level, (...data) => log(level, ...data)]));

/*
async function monitorBrowsers(unprint) {
	await timers.setTimeout(60_000);

	const clients = unprint.getAllBrowsers();

	const checkedClients = await Promise.all(Array.from(clients.values()).map(async (client) => {
		if (new Date() - client.lastUsedAt > 300_000) { // 5 minute expiry
			return unprint.closeBrowser(client, { client: null });
		}

		return false;
	}));

	const closedClients = checkedClients.filter(Boolean).length;

	logger.info(`Closed ${closedClients}/${checkedClients.length} browsers`);

	monitorBrowsers(unprint);
}
*/

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

async function initServer(address, _unprint) {
	const app = express();
	const addressComponents = typeof address === 'boolean' ? [] : String(address).split(':');

	const host = addressComponents[1] ? addressComponents[0] : '127.0.0.1';
	const port = addressComponents[1] || addressComponents[0] || 3000;

	expressWs(app);
	app.use(express.json());

	app.use(async (req, _res, next) => {
		if (process.env.UNPRINT_KEY && req.path !== '/') {
			if (process.env.UNPRINT_KEY.length !== req.headers['unprint-key']?.length
			|| !crypto.timingSafeEqual(Buffer.from(process.env.UNPRINT_KEY, 'utf16le'), Buffer.from(req.headers['unprint-key'], 'utf16le'))) {
				logger.warn(`Invalid key used by ${req.ip}`);

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

	// monitorBrowsers(unprint);

	const browser = await chromium.launchServer({
		headless: false,
	});

	const browserEndpoint = browser.wsEndpoint();

	app.ws('/browser', (clientSocket, _req) => {
		const browserSocket = new WebSocket(browserEndpoint);
		let queue = [];

		logger.info('Client connected');

		clientSocket.on('message', (data) => {
			logger.silly(`Socket data (${browserSocket.readyState === WebSocket.OPEN ? 'sent' : 'queued'}): ${data}`);

			if (browserSocket.readyState === WebSocket.OPEN) {
				browserSocket.send(data);
			} else {
				queue.push(data);
			}
		});

		browserSocket.on('open', () => {
			logger.debug(`Browser connected, clearing ${queue.length} queue messages`);

			queue.forEach((data) => browserSocket.send(data));
			queue = [];

			browserSocket.on('message', (data) => {
				if (clientSocket.readyState === WebSocket.OPEN) {
					clientSocket.send(data);
				}
			});
		});

		clientSocket.on('close', (code, reason) => {
			closeSocket(browserSocket, code, reason);
			logger.info('Client disconnected');
		});

		browserSocket.on('close', (code, reason) => {
			closeSocket(clientSocket, code, reason);
			logger.warn('Browser disconnected');
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

module.exports = initServer;
