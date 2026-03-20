'use strict';

// const { chromium } = require('patchright');

const unprint = require('../src/app');

const key = 'foobar';

unprint.configure({
	remote: {
		enable: true,
		use: false,
		address: 'ws://127.0.0.1:3333/browser',
		key,
	},
});

async function init() {
	unprint.on('requestInit', (event) => console.log('INIT', event));
	unprint.on('browserClose', (event) => console.log('CLOSE', event));

	const res = await unprint.browser('https://www.google.com', {
		useRemote: true,
		async control(page) {
			return page.locator('form').count();
		},
	});

	if (!res.ok) {
		console.log(res);
		return;
	}

	const form = res.context.query.element('form');

	console.log('control', res.control);
	console.log('form', form);
}

init();

/*
async function initRaw() {
	const browser = await chromium.connect('ws://127.0.0.1:3333/browser', {
		headers: {
			'unprint-key': key,
		},
	});

	// await timers.setTimeout(2000);

	const context = await browser.newContext();
	const page = await context.newPage();

	await page.goto('https://jsonplaceholder.typicode.com');
	await page.locator('.mb-one').hover({ trial: true, timeout: 10000, strict: false });

	const content = await page.content();

	console.log(content);

	await page.close();
}

initRaw();
*/
