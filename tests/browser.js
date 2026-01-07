'use strict';

const unprint = require('../src/app');

unprint.options({ // or unprint.options();
	proxy: {
		enable: true,
		use: false, // don't use for all requests by default
		host: '192.168.1.25',
		port: 8888,
		hostnames: [
			'tools-httpstatus.pickup-services.com',
		],
	},
});

async function initTest() {
	// concurrency
	/*
	console.log('TEST CONCURRENCY');
	await Promise.all(Array.from({ length: 20 }).map(async () => {
		// await unprint.browser(`https://tools-httpstatus.pickup-services.com/${Math.random() < 0.2 ? '404' : '200'}?sleep=${Math.round(Math.random() * 500)}`, {
		await unprint.browser(`https://tools-httpstatus.pickup-services.com/200?sleep=${Math.round(Math.random() * 5000)}`, {
			// client: null,
			interval: 100,
			browser: {
				headless: true,
			},
		});
	}));
	*/

	// console.log('Requests done, waiting...');

	// 	await new Promise((resolve) => { setTimeout(() => resolve(), 60 * 60 * 1000); });
	// timeout
	console.log('TEST TIMEOUT');
	await unprint.browser('https://tools-httpstatus.pickup-services.com/200?sleep=30000', {
		// client: null,
		browser: {
			headless: true,
		},
		page: {
			timeout: 5000,
		},
	});

	/*
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
					// return new Promise((resolve) => { setTimeout(() => resolve(), 60000); });
				},
			});
		}),
	]);

	console.log('TEST SCRAPE');
	const res = await unprint.browser('https://www.scrapingcourse.com/', {
		browser: {
			headless: false,
		},
		async control(_page) {
			// await new Promise((resolve) => { setTimeout(() => resolve(), 60000); });
		},
	});

	const cards = res.context.query.contents('h2');

	console.log('CARD TITLES', cards);
	console.log('CONTROL OUT', res.control);
	*/
	console.log('CLOSING ALL BROWSERS');

	await unprint.closeAllBrowsers();
}

initTest();
