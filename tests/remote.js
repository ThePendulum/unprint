'use strict';

const unprint = require('../src/app');

unprint.configure({
	remote: {
		enable: true,
		address: 'http://127.0.0.1:3333',
		key: 'foobar',
	},
});

async function init() {
	const res = await unprint.browser('https://www.google.com', {
		useRemote: true,
		async control(page) {
			const form = await page.locator('form');

			return form.count();
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
