'use strict';

const unprint = require('../src/app');

async function initTest() {
	await unprint.browser('https://tools-httpstatus.pickup-services.com/200?sleep=5000', {
		headless: false,
		async control(_page) {
			//
		},
	});

	await unprint.browser('https://tools-httpstatus.pickup-services.com/200?sleep=2000', {
		headless: false,
		async control(_page) {
			//
		},
	});

	const res = await unprint.browser('https://www.scrapingcourse.com/', {
	// await unprint.browser('https://www.scrapingcourse.com/', {
		headless: false,
		async control(_page) {
			//
		},
	});

	const cards = res.context.query.contents('h2');

	console.log('CARD TITLES', cards);

	await unprint.closeAllBrowsers();
}

initTest();
