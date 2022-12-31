'use strict';

const path = require('path');
const express = require('express');
// const unprint = require('unprint');

const unprint = require('../src/app');
const data = require('./data.json');

const port = process.env.PORT || 3101;

async function initTest() {
	unprint.options({ headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/106.0.0.0 Safari/537.36' } });

	const res = await unprint.get(`http://127.0.0.1:${port}/html`, { select: 'body' });
	// const jsonRes = await unprint.get(`http://127.0.0.1:${port}/json`);
	// const errorRes = await unprint.get(`http://127.0.0.1:${port}/error/404`);

	console.log('title', res.context.query.content('//*[contains(text(), "Test")]'));
	console.log('date', res.context.query.date('#date', 'DD-MM-YYYY HH:mm'));
	console.log('date xpath', res.context.query.date('//div[contains(text(), "Today:")]', 'MMM DD, YYYY'));
	console.log('duration', res.context.query.duration('#duration'));
	console.log('timestamp', res.context.query.duration('#timestamp'));
	console.log('number', res.context.query.number('.number'));
	console.log('numbers', res.context.query.numbers('.number'));
	console.log('data', res.context.query.json('#json'));
	console.log('items', res.context.query.contents('.item'));
	console.log('link', res.context.query.url('#link'));
	console.log('links', res.context.query.urls('.link'));
	console.log('image', res.context.query.img('.image'));
	console.log('images', res.context.query.imgs('.image'));
	console.log('srcset', res.context.query.sourceSet('.srcset'));
	console.log('path', res.context.query.url('#path'));
	console.log('relative path', res.context.query.url('#relativePath'));
	console.log('exists', res.context.query.exists('#title'));
	console.log('count', res.context.query.count('.item'), res.context.query.count('.foo'));
	console.log('video', res.context.query.video());
	console.log('poster', res.context.query.poster());
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
