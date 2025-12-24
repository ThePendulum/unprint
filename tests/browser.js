'use strict';

const unprint = require('../src/app');

async function initTest() {
	// concurrency
	await Promise.all([
		unprint.browser('https://tools-httpstatus.pickup-services.com/200?sleep=500', {
			browser: {
				headless: false,
			},
		}),
		unprint.browser('https://tools-httpstatus.pickup-services.com/200?sleep=500', {
			browser: {
				headless: false,
			},
		}),
		unprint.browser('https://tools-httpstatus.pickup-services.com/200?sleep=500', {
			browser: {
				headless: false,
			},
		}),
	]);

	await Promise.all([
		unprint.browser('https://tools-httpstatus.pickup-services.com/200?sleep=5000', {
			browser: {
				headless: false,
			},
			async control(_page) {
				//
			},
		}),
		new Promise((resolve) => {
			setTimeout(() => {
				resolve();
			}, 1000);
		}).then(async () => {
			await unprint.browser('https://tools-httpstatus.pickup-services.com/200?sleep=2000', {
				browser: {
					headless: false,
				},
				async control(_page) {
					//
				},
			});
		}),
	]);

	const res = await unprint.browser('https://www.scrapingcourse.com/', {
	// await unprint.browser('https://www.scrapingcourse.com/', {
		headless: false,
		async control(_page) {
			return 'test';
		},
	});

	const cards = res.context.query.contents('h2');

	console.log('CARD TITLES', cards);
	console.log('CONTROL OUT', res.control);

	await unprint.closeAllBrowsers();
}

initTest();
