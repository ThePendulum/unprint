'use strict';

const crypto = require('crypto');
const express = require('express');

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
	'error',
	'warn',
].map((level) => [level, (...data) => log(level, ...data)]));

function curateOptions(options) {
	// make sure remote unprint doesn't get configured to make request to itself
	return {
		...options,
		remote: {
			enable: false,
		},
		useRemote: false,
		control: options.control
			? async function control() {}.constructor('page', 'client', options.control) // eslint-disable-line no-eval,no-new-func,no-empty-function
			: null,
	};
}

async function handleRequest(req, res, unprint, method) {
	if (!req.body?.url) {
		throw new HttpError('No URL provided', 400);
	}

	logger.info(`${(method || req.body.method || 'get').toLowerCase()} ${req.body.url}`);

	const options = curateOptions(req.body.options);

	const unprintRes = await unprint.request(req.body.url, {
		...options,
		method: req.body.method,
		body: req.body.data,
	});

	res.send({
		ok: unprintRes.ok,
		status: unprintRes.status,
		statusText: unprintRes.statusText,
		data: unprintRes.data || null,
		body: unprintRes.body || null,
		html: unprintRes.context?.html || null,
		headers: unprintRes.headers,
		cookies: unprintRes.cookies,
		control: unprintRes.control,
	});
}

async function initServer(address, unprint) {
	const app = express();
	const addressComponents = typeof address === 'boolean' ? [] : String(address).split(':');

	const host = addressComponents[1] ? addressComponents[0] : '127.0.0.1';
	const port = addressComponents[1] || addressComponents[0] || 3000;

	app.use(express.json());

	app.use(async (req, res, next) => {
		if (process.env.UNPRINT_KEY) {
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

	app.post('/request', async (req, res) => handleRequest(req, res, unprint));
	app.post('/browser', async (req, res) => handleRequest(req, res, unprint, 'browser'));

	app.post('/options', async (req, res) => {
		if (!req.body) {
			throw new HttpError('No options provided', 400);
		}

		unprint.options(curateOptions(req.body));

		res.status(204).send();
	});

	app.use((error, _req, res, _next) => {
		logger.error(error);

		res.status(error.httpCode || 500).send({
			statusCode: error.httpCode || 500,
			statusMessage: error.message,
		});
	});

	app.listen(port, host, (error) => {
		if (error) {
			logger.error(`Failed to start server: ${error.message}`);
			return;
		}

		logger.info(`Started unprint server on ${host}:${port}`);
	});
}

module.exports = initServer;
