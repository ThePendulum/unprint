'use strict';

const { JSDOM, VirtualConsole } = require('jsdom');
const axios = require('axios').default;
const moment = require('moment-timezone');

const settings = {
	throwErrors: false,
	logErrors: true,
	requestTimeout: 30000,
};

const virtualConsole = new VirtualConsole();
const { window: globalWindow } = new JSDOM('', { virtualConsole });

function handleError(error, code) {
	if (settings.logErrors) {
		console.error(`unprint encountered an error (${code}): ${error.message}`);
	}

	if (settings.throwErrors) {
		throw Object.assign(error, { code });
	}

	return null;
}

virtualConsole.on('error', (message) => handleError(message, 'JSDOM'));
virtualConsole.on('jsdomError', (message) => handleError(message, 'JSDOM'));

const defaultOptions = {
	trim: true,
};

function trim(string) {
	if (typeof string === 'string') {
		return string.trim().replace(/\s+/g, ' ');
	}

	return string;
}

function iterateXpathResult(iterator, results = []) {
	const element = iterator.iterateNext();

	if (element) {
		return iterateXpathResult(iterator, results.concat(element));
	}

	return results;
}

function getElements(element, selector, firstOnly = false) {
	if (!selector) {
		return element;
	}

	if (/^\/\//.test(selector)) {
		// XPath selector
		const iterator = globalWindow.document.evaluate(selector, element, null, globalWindow.XPathResult.ORDERED_NODE_ITERATOR_TYPE, null);

		if (firstOnly) {
			return iterator.iterateNext();
		}

		return iterateXpathResult(iterator);
	}

	if (firstOnly) {
		return element.querySelector(selector);
	}

	return Array.from(element.querySelectorAll(selector));
}

function queryElement(element, selectors, _customOptions) {
	if (!selectors && element.nodeName === '#document') {
		return null;
	}

	const target = [].concat(selectors).reduce((acc, selector) => acc || getElements(element, selector, true), null);

	return target || null;
}

function queryElements(element, selectors, _customOptions) {
	if (!selectors) {
		return element;
	}

	const targets = [].concat(selectors).reduce((acc, selector) => acc || getElements(element, selector, false), null);

	return targets || [];
}

function queryExistence(element, selector, customOptions) {
	return !!queryElement(element, selector, customOptions);
}

function extractContent(element, options) {
	if (options.attribute) {
		const attribute = element[options.attribute] || element.getAttribute(options.attribute);

		if (attribute && options.trim) {
			return trim(attribute);
		}

		return attribute;
	}

	if (options.trim) {
		return trim(element.textContent);
	}

	return element.textContent;
}

function queryContent(element, selector, customOptions) {
	const options = { ...defaultOptions, ...customOptions };
	const target = queryElement(element, selector, options);

	return extractContent(target, options);
}

function queryContents(element, selector, customOptions) {
	const options = { ...defaultOptions, ...customOptions };
	const targets = queryElements(element, selector, options);

	return targets.map((target) => extractContent(target, options));
}

function queryAttribute(element, selector, attribute, customOptions) {
	return queryContent(element, selector, {
		...customOptions,
		attribute,
	});
}

function queryAttributes(element, selector, attribute, customOptions) {
	return queryContents(element, selector, {
		...customOptions,
		attribute,
	});
}

function queryHtml(element, selector, customOptions) {
	const target = queryElement(element, selector, customOptions);

	if (target) {
		return trim(target.innerHTML);
	}

	return null;
}

function queryHtmls(element, selector, customOptions) {
	const targets = queryElements(element, selector, customOptions);

	return targets.map((target) => trim(target.innerHTML));
}

function extractJson(element) {
	if (!element) {
		return null;
	}

	try {
		return JSON.parse(element.innerHTML);
	} catch (error) {
		return null;
	}
}

function queryJson(element, selector, customOptions) {
	const target = queryElement(element, selector, customOptions);

	return extractJson(target);
}

function queryJsons(element, selector, customOptions) {
	const targets = queryElements(element, selector, customOptions);

	return targets.map((target) => extractJson(target)).filter(Boolean);
}

function extractDate(dateString, format, customOptions) {
	if (!dateString) {
		return null;
	}

	if (!format) {
		return handleError(new Error('Missing required date format parameter'), 'NO_DATE_FORMAT');
	}

	const options = {
		...defaultOptions,
		match: /((\d{1,4}[/-]\d{1,2}[/-]\d{1,4})|(\w+\s+\d{1,2},?\s+\d{4}))(\s+\d{1,2}:\d{2}(:\d{2})?)?/g, // matches any of 01-01-1970, 1970-01-01 and January 1, 1970 with optional 00:00[:00] time
		timezone: 'UTC',
		...customOptions,
	};

	const dateStamp = options.match
		? trim(dateString).match(options.match)
		: trim(dateString);

	if (dateStamp) {
		const dateValue = moment.tz(options.match ? dateStamp[0] : dateStamp, format, options.timezone);

		if (dateValue.isValid()) {
			return dateValue.toDate();
		}
	}

	return null;
}

function queryDate(element, selector, format, customOptions) {
	const dateString = queryContent(element, selector, customOptions);

	return extractDate(dateString, format, customOptions);
}

function queryDates(element, selector, format, customOptions) {
	const dateStrings = queryContents(element, selector, customOptions);

	return dateStrings.map((dateString) => extractDate(dateString, format, customOptions));
}

const queryFns = {
	element: queryElement,
	elements: queryElements,
	el: queryElement,
	els: queryElements,
	all: queryElements,
	content: queryContent,
	contents: queryContents,
	attribute: queryAttribute,
	attributes: queryAttributes,
	attr: queryAttribute,
	attrs: queryAttributes,
	exists: queryExistence,
	html: queryHtml,
	htmls: queryHtmls,
	json: queryJson,
	jsons: queryJsons,
	date: queryDate,
	dates: queryDates,
	extractDate,
};

function initFns(context, fns) {
	return Object.fromEntries(Object.entries(fns).map(([key, fn]) => [key, (...args) => fn(context, ...args)]));
}

function init(context, selector, options) {
	if (!context) {
		return null;
	}

	if (typeof context === 'string') {
		// the context should be raw HTML
		const { window } = new JSDOM(context, { virtualConsole, ...options.parser });

		return init(window.document, selector, { ...options, window });
	}

	if (!context.querySelector) {
		// the context is not a valid
		return null;
	}

	const element = selector
		? context.querySelector(selector)
		: context;

	if (!element) {
		return null;
	}

	return {
		element,
		html: element.outerHTML || element.body.outerHTML,
		...(options.window && {
			window: options.window,
			document: options.window.document,
		}),
		query: initFns(context, queryFns),
	};
}

function initAll(context, selector, options) {
	if (Array.isArray(context)) {
		return context.map((element) => init(element, selector, options));
	}

	if (typeof context === 'string') {
		// the context should be raw HTML
		const { window } = new JSDOM(context, { virtualConsole, ...options.parser });

		return initAll(window.document, selector, { ...options, window });
	}

	if (!(context instanceof globalWindow.HTMLElement)) {
		handleError(new Error('Init context is not a DOM element, HTML or an array'), 'INVALID_CONTEXT');
	}

	return Array.from(context.querySelectorAll(options.select))
		.map((element) => init(element, selector, options));
}

async function request(url, data, customOptions = {}, method = 'GET') {
	const options = {
		timeout: 1000,
		extract: true,
		...customOptions,
	};

	const res = await axios({
		url,
		method,
		data,
		validateStatus: null,
		timeout: options.timeout,
		signal: options.abortSignal,
		...options,
	});

	if (!(res.status >= 200 && res.status < 300)) {
		handleError(new Error(`HTTP response from ${url} not OK (${res.status} ${res.statusText}): ${res.data}`), 'HTTP_NOT_OK');

		return res.status;
	}

	if (res.headers['content-type'].includes('application/json') && typeof res.data === 'object') {
		return {
			data,
			ok: true,
			status: res.status,
			statusText: res.statusText,
			response: res,
			res,
		};
	}

	const context = options.selectAll
		? initAll(res.data, options.selectAll, options)
		: init(res.data, options.select, options);

	return {
		context,
		html: res.data,
		ok: true,
		status: res.status,
		response: res,
		res,
	};
}

async function get(url, options) {
	return request(url, null, options, 'GET');
}

async function post(url, body, options) {
	return request(url, body, options, 'POST');
}

module.exports = {
	get,
	post,
	request,
	initialize: init,
	initializeAll: initAll,
	init,
	initAll,
	query: queryFns,
};
