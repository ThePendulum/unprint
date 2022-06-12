'use strict';

const path = require('path');
const express = require('express');
const unprint = require('unprint');

const data = require('./data.json');
const port = process.env.PORT || 3101;

async function initTest() {
	console.log(unprint);

	const res = await unprint.get(`http://127.0.0.1:${port}/html`, { select: 'body' });
	// const jsonRes = await unprint.get(`http://127.0.0.1:${port}/json`);
	// const errorRes = await unprint.get(`http://127.0.0.1:${port}/error/404`);

	console.log('title', res.context.query.element('#title'), res.context.query.content('//*[contains(text(), "Test")]'));
	console.log('date', res.context.query.date('#date', 'DD-MM-YYYY HH:mm'));
	console.log('data', res.context.query.json('#json'));
	console.log('items', res.context.query.contents('.item'));
}

async function initServer() {
	const app = express();

	app.use((req, res, next) => {
		if (req.query.delay) {
			setTimeout(() => {
				next();
			}, req.query.delay);

			return;
		}

		next();
	});

	app.get('/html', (req, res) => {
		res.sendFile(path.resolve(__dirname, 'index.html'));
	});

	app.get('/json', (req, res) => {
		res.send(data);
	});

	app.get('/error/:code', (req, res) => {
		res.status(Number(req.params.code)).send();
	});

	const server = app.listen(port, async () => {
		const { address } = server.address();

		console.log(`Test server listening on ${address}:${port}`);

		await initTest();
	});
}

initServer();
