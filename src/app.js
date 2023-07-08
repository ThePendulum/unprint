'use strict';

const { JSDOM, VirtualConsole } = require('jsdom');
const axios = require('axios').default;
const moment = require('moment-timezone');
const merge = require('deepmerge');

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

let globalOptions = {};

function configure(newOptions) {
	globalOptions = newOptions;
}

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

function getElements(context, selector, firstOnly = false) {
	if (!selector) {
		return context.element;
	}

	if (/^\//.test(selector)) {
		// XPath selector
		const iterator = globalWindow.document.evaluate(selector, context.element, null, globalWindow.XPathResult.ORDERED_NODE_ITERATOR_TYPE, null);

		if (firstOnly) {
			return iterator.iterateNext();
		}

		return iterateXpathResult(iterator);
	}

	if (firstOnly) {
		return context.element.querySelector(selector);
	}

	return Array.from(context.element.querySelectorAll(selector));
}

function queryElement(context, selectors, _customOptions) {
	if (!selectors && context.element.nodeName === '#document') {
		return null;
	}

	const target = [].concat(selectors).reduce((acc, selector) => acc || getElements(context, selector, true), null);

	return target || null;
}

function queryElements(context, selectors, _customOptions) {
	if (!selectors) {
		return context.element;
	}

	const targets = [].concat(selectors).reduce((acc, selector) => acc || getElements(context, selector, false), null);

	return targets || [];
}

function queryExistence(context, selector, customOptions) {
	return !!queryElement(context, selector, customOptions);
}

function queryCount(context, selector, customOptions) {
	return queryElements(context, selector, customOptions)?.length || 0;
}

function getAttributeKey(options) {
	if (!options) {
		return null;
	}

	if (Object.hasOwn(options, 'attr')) {
		return options.attr;
	}

	if (Object.hasOwn(options, 'attribute')) {
		return options.attribute;
	}

	return null;
}

function extractContent(element, options) {
	if (!element) {
		return null;
	}

	const attributeKey = getAttributeKey(options);

	if (attributeKey) {
		// handle attribute extraction in content method so all methods can easily optionally query a specific attribute
		const attribute = element[attributeKey] || element.getAttribute(attributeKey);

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

function queryContent(context, selector, customOptions) {
	const options = { ...context.options, ...customOptions };
	const target = queryElement(context, selector, options);

	return extractContent(target, options);
}

function queryContents(context, selector, customOptions) {
	const options = { ...context.options, ...customOptions };
	const targets = queryElements(context, selector, options);

	return targets.map((target) => extractContent(target, options)).filter(Boolean);
}

function queryAttribute(context, selector, attribute, customOptions) {
	return queryContent(context, selector, {
		...customOptions,
		attribute,
	});
}

function queryAttributes(context, selector, attribute, customOptions) {
	return queryContents(context, selector, {
		...customOptions,
		attribute,
	});
}

function queryDataset(context, selector, dataAttribute, customOptions) {
	const target = queryElement(context, selector, customOptions);

	return target.dataset[dataAttribute];
}

function queryDatasets(context, selector, dataAttribute, customOptions) {
	const targets = queryElements(context, selector, customOptions);

	return targets.map((target) => target.dataset[dataAttribute]);
}

const defaultNumberRegexp = /\d+(\.\d+)?/;

function matchNumberString(numberString, options) {
	if (numberString && options.match) {
		return Number(numberString.match(options.match)?.[options.matchIndex]) || null;
	}

	if (numberString) {
		return Number(numberString) || null;
	}

	return null;
}

function queryNumber(context, selector, customOptions) {
	const numberString = queryContent(context, selector, customOptions);

	const options = {
		match: defaultNumberRegexp,
		matchIndex: 0,
		...customOptions,
	};

	return matchNumberString(numberString, options);
}

function queryNumbers(context, selector, customOptions) {
	const numberStrings = queryContents(context, selector, customOptions);

	const options = {
		match: defaultNumberRegexp,
		matchIndex: 0,
		...customOptions,
	};

	if (!numberStrings) {
		return null;
	}

	return numberStrings
		.map((numberString) => matchNumberString(numberString, options))
		.filter(Boolean);
}

function queryHtml(context, selector, customOptions) {
	const target = queryElement(context, selector, customOptions);

	if (target) {
		return trim(target.innerHTML);
	}

	return null;
}

function queryHtmls(context, selector, customOptions) {
	const targets = queryElements(context, selector, customOptions);

	return targets.map((target) => trim(target.innerHTML));
}

function extractText(target, customOptions) {
	const options = {
		filter: true,
		trim: true,
		join: true,
		...customOptions,
	};

	const nodes = Array.from(target.childNodes)
		.filter((node) => node.nodeName === '#text')
		.map((node) => (options.trim ? trim(node.textContent) : node.textContent));

	const filteredNodes = options.filter
		? nodes.filter(Boolean)
		: nodes;

	if (options.join) {
		const text = filteredNodes.join(typeof options.join === 'string' ? options.join : ' ');

		if (options.trim) {
			return text.trim();
		}

		return text;
	}

	return filteredNodes;
}

function queryText(context, selector, customOptions) {
	const target = queryElement(context, selector, customOptions);

	if (!target) {
		return null;
	}

	return extractText(target, customOptions);
}

function queryTexts(context, selector, customOptions) {
	const targets = queryElements(context, selector, customOptions);

	return targets.map((target) => extractText(target, customOptions));
}

function prefixUrl(urlPath, originUrl, customOptions) {
	if (!urlPath) {
		return null;
	}

	if (!originUrl) {
		return urlPath;
	}

	const options = {
		protocol: 'https',
		...customOptions,
	};

	const { origin, protocol } = new URL(originUrl);

	if (/^http/.test(urlPath)) {
		// this is already a complete URL
		return urlPath;
	}

	if (options.protocol && /^\/\//.test(urlPath)) {
		return `${options.protocol.replace(/:$/, '')}:${urlPath}`; // allow protocol to be defined either as 'https' or 'https:'
	}

	if (protocol && /^\/\//.test(urlPath)) {
		return `${protocol}${urlPath}`;
	}

	if (/^\//.test(urlPath)) {
		return `${origin}${urlPath}`;
	}

	if (/^\.\//.test(urlPath)) {
		return `${originUrl.replace(/\/+$/, '')}${urlPath.slice(1)}`;
	}

	return `${origin}/${urlPath}`;
}

function queryUrl(context, selector = 'a', customOptions) {
	const options = {
		...context.options,
		attribute: 'href',
		...customOptions,
	};

	const url = queryContent(context, selector, options);

	return prefixUrl(url, options.origin, customOptions);
}

function queryUrls(context, selector = 'a', customOptions) {
	const options = {
		...context.options,
		attribute: 'href',
		...customOptions,
	};

	const urls = queryContents(context, selector, options);

	return urls.map((url) => prefixUrl(url, options.origin, customOptions));
}

function getImageUrl(context, selector, options) {
	const attributeKey = getAttributeKey(options);

	if (attributeKey) {
		return queryAttribute(context, selector, attributeKey, options);
	}

	return queryAttribute(context, selector, 'data-src', options)
		|| queryAttribute(context, selector, 'src', options);
}

function getImageUrls(context, selector, options) {
	const attributeKey = getAttributeKey(options);

	if (attributeKey) {
		return queryAttributes(context, selector, attributeKey, options);
	}

	const dataLinks = queryAttributes(context, selector, 'data-src', options);

	if (dataLinks.lenght > 0) {
		return dataLinks;
	}

	return queryAttributes(context, selector, 'src', options);
}

function queryImage(context, selector = 'img', customOptions) {
	const options = {
		...context.options,
		...customOptions,
	};

	const imageUrl = getImageUrl(context, selector, options);

	return prefixUrl(imageUrl, options.origin, options);
}

function queryImages(context, selector = 'img', customOptions) {
	const options = {
		...context.options,
		...customOptions,
	};

	const imageUrls = getImageUrls(context, selector, options);

	return imageUrls.map((imageUrl) => prefixUrl(imageUrl, options.origin, options));
}

function extractSourceSet(sourceSet, customOptions) {
	if (!sourceSet) {
		return null;
	}

	const sources = sourceSet
		.split(/\s*,\s*/)
		.map((source) => {
			const [link, descriptor] = source.split(' ');

			if (link) {
				return {
					descriptor: descriptor || 'fallback',
					url: prefixUrl(link, customOptions.origin, customOptions.protocol),
				};
			}

			return null;
		})
		.filter(Boolean)
		.sort((sourceA, sourceB) => {
			if (sourceB.descriptor === 'fallback' || parseInt(sourceA.descriptor, 10) > parseInt(sourceB.descriptor, 10)) {
				return -1;
			}

			if (parseInt(sourceA.descriptor, 10) < parseInt(sourceB.descriptor, 10)) {
				return 1;
			}

			return 0;
		});

	if (customOptions.includeDescriptor) {
		return sources.map((source) => ({
			descriptor: source.descriptor,
			url: prefixUrl(source.url),
		}));
	}

	return sources.map((source) => prefixUrl(source.url));
}

function querySourceSet(context, selector, attr = 'srcset', customOptions = {}) {
	const sourceSet = queryAttribute(context, selector, attr, customOptions);

	return extractSourceSet(sourceSet, customOptions);
}

function querySourceSets(context, selector, attr = 'srcset', customOptions = {}) {
	const sourceSets = queryAttributes(context, selector, attr, customOptions);

	return sourceSets.map((sourceSet) => extractSourceSet(sourceSet, customOptions));
}

function queryVideo(context, selector = 'source', customOptions) {
	const options = {
		...context.options,
		attribute: 'src',
		...customOptions,
	};

	const videoUrl = queryContent(context, selector, options);

	return prefixUrl(videoUrl, options.origin, options);
}

function queryVideos(context, selector = 'source', customOptions) {
	const options = {
		...context.options,
		attribute: 'src',
		...customOptions,
	};

	const videoUrls = queryContents(context, selector, options);

	return videoUrls.map((videoUrl) => prefixUrl(videoUrl, options.origin, options));
}

function queryPoster(context, selector = 'video', customOptions) {
	const options = {
		attribute: 'poster',
		...customOptions,
	};

	const posterUrl = queryContent(context, selector, options);

	return prefixUrl(posterUrl, options.origin, options);
}

function queryPosters(context, selector = 'video', customOptions) {
	const options = {
		attribute: 'poster',
		...customOptions,
	};

	const posterUrls = queryContents(context, selector, options);

	return posterUrls.map((posterUrl) => prefixUrl(posterUrl, options.origin, options));
}

function extractJson(dataString) {
	if (!dataString) {
		return null;
	}

	try {
		return JSON.parse(dataString);
	} catch (error) {
		return null;
	}
}

function queryJson(context, selector, customOptions) {
	const dataString = queryContent(context, selector, customOptions);

	return extractJson(dataString);
}

function queryJsons(context, selector, customOptions) {
	const dataStrings = queryContents(context, selector, customOptions);

	return dataStrings.map((dataString) => extractJson(dataString)).filter(Boolean);
}

function extractDate(dateString, format, customOptions) {
	if (!dateString) {
		return null;
	}

	if (!format) {
		return handleError(new Error('Missing required date format parameter'), 'NO_DATE_FORMAT');
	}

	const options = {
		match: /((\d{1,4}[/-]\d{1,2}[/-]\d{1,4})|(\w+\s+\d{1,2},?\s+\d{4}))(\s+\d{1,2}:\d{2}(:\d{2})?)?/g, // matches any of 01-01-1970, 1970-01-01 and January 1, 1970 with optional 00:00[:00] time
		matchIndex: 0,
		timezone: 'UTC',
		...customOptions,
	};

	const dateStamp = options.match
		? trim(dateString).match(options.match)
		: trim(dateString);

	if (dateStamp) {
		const dateValue = moment.tz(options.match ? dateStamp[options.matchIndex] : dateStamp, format, options.timezone);

		if (dateValue.isValid()) {
			return dateValue.toDate();
		}
	}

	return null;
}

function queryDate(context, selector, format, customOptions) {
	const dateString = queryContent(context, selector, customOptions);

	return extractDate(dateString, format, {
		...context.options,
		...customOptions,
	});
}

function queryDates(context, selector, format, customOptions) {
	const dateStrings = queryContents(context, selector, customOptions);

	return dateStrings.map((dateString) => extractDate(dateString, format, {
		...context.options,
		customOptions,
	}));
}

function formatDate(dateValue, format, inputFormat) {
	if (inputFormat) {
		return moment(dateValue, inputFormat).format(format);
	}

	return moment(dateValue).format(format);
}

function extractDuration(durationString, match) {
	const durationMatch = durationString?.match(match || /(\d+:)?\d+:\d+/);

	if (durationMatch) {
		const segments = ['00'].concat(durationMatch[0].split(/[:hm]/)).slice(-3);

		return moment.duration(segments.join(':')).asSeconds();
	}

	return null;
}

function extractTimestamp(durationString) {
	const timestampMatch = durationString?.match(/(\d+H)?\s*(\d+M)?\s*\d+S?/i);

	if (timestampMatch) {
		const hours = timestampMatch[0].match(/(\d+)H/i)?.[1] || 0;
		const minutes = timestampMatch[0].match(/(\d+)M/i)?.[1] || 0;
		const seconds = timestampMatch[0].match(/(\d+)(S|$)/i)?.[1] || 0;

		return (Number(hours) * 3600) + (Number(minutes) * 60) + Number(seconds);
	}

	return null;
}

function queryDuration(context, selector, customOptions) {
	const options = { ...customOptions };
	const durationString = queryContent(context, selector, customOptions);

	if (!durationString) {
		return null;
	}

	if (options.match) {
		return extractDuration(durationString, options.match);
	}

	return extractDuration(durationString)
		|| extractTimestamp(durationString)
		|| null;
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
	dataset: queryDataset,
	datasets: queryDatasets,
	data: queryDataset,
	datas: queryDatasets,
	exists: queryExistence,
	count: queryCount,
	html: queryHtml,
	htmls: queryHtmls,
	image: queryImage,
	images: queryImages,
	img: queryImage,
	imgs: queryImages,
	json: queryJson,
	jsons: queryJsons,
	number: queryNumber,
	num: queryNumber,
	numbers: queryNumbers,
	nums: queryNumbers,
	poster: queryPoster,
	posters: queryPosters,
	date: queryDate,
	dates: queryDates,
	duration: queryDuration,
	dur: queryDuration,
	sourceSet: querySourceSet,
	sourceSets: querySourceSets,
	srcSet: querySourceSet,
	srcSets: querySourceSets,
	text: queryText,
	texts: queryTexts,
	url: queryUrl,
	urls: queryUrls,
	video: queryVideo,
	videos: queryVideos,
};

function isDomObject(element) {
	if (!element) {
		return false;
	}

	return typeof element.nodeType !== 'undefined';
}

function initQueryFns(fns, context) {
	if (context) {
		return Object.fromEntries(Object.entries(fns).map(([key, fn]) => [key, (...args) => fn(context, ...args)]));
	}

	// context is passed directly to query method
	return Object.fromEntries(Object.entries(fns).map(([key, fn]) => [key, (...args) => {
		// first argument is already an unprint context. this seems like a convoluted approach, but there is little reason not to allow it
		if (args[0]?.isUnprint) {
			return fn(...args);
		}

		// most common usage is to pass an element directly, convert to context
		if (isDomObject(args[0])) {
			const element = args[0];

			return fn({
				element,
				html: element.outerHTML || element.body?.outerHTML,
				isUnprint: true,
			}, ...args.slice(1));
		}

		return handleError(new Error('Context is not provided or initialized'), 'INVALID_CONTEXT');
	}]));
}

function init(elementOrHtml, selector, options = {}) {
	if (!elementOrHtml) {
		return null;
	}

	if (typeof elementOrHtml === 'string') {
		// the context should be raw HTML
		const { window } = new JSDOM(elementOrHtml, { virtualConsole, ...options.parser });

		return init(window.document, selector, { ...options, window });
	}

	if (!isDomObject(elementOrHtml)) {
		// the context is not a valid
		return handleError(new Error('Init context is not a DOM element, HTML or an array'), 'INVALID_CONTEXT');
	}

	const element = selector
		? queryElement({ element: elementOrHtml }, selector)
		: elementOrHtml;

	if (!element) {
		return null;
	}

	const context = {
		element,
		html: element.outerHTML || element.body?.outerHTML,
		...(options.window && {
			window: options.window,
			document: options.window.document,
		}),
		options,
		isUnprint: true,
	};

	context.query = initQueryFns(queryFns, context);

	return context;
}

function initAll(context, selector, options = {}) {
	if (Array.isArray(context)) {
		return context.map((element) => init(element, selector, options));
	}

	if (typeof context === 'string') {
		// the context should be raw HTML
		const { window } = new JSDOM(context, { virtualConsole, ...options.parser });

		return initAll(window.document, selector, { ...options, window });
	}

	if (!isDomObject(context)) {
		// the context is not a valid
		return handleError(new Error('Init context is not a DOM element, HTML or an array'), 'INVALID_CONTEXT');
	}

	return queryElements({ element: context }, selector)
		.map((element) => init(element, null, options));
}

async function request(url, body, customOptions = {}, method = 'GET') {
	const options = merge.all([{
		timeout: 1000,
		extract: true,
		url,
	}, globalOptions, customOptions]);

	const res = await axios({
		url,
		method,
		data: body,
		validateStatus: null,
		timeout: options.timeout,
		signal: options.abortSignal,
		...options,
	});

	if (!(res.status >= 200 && res.status < 300)) {
		handleError(new Error(`HTTP response from ${url} not OK (${res.status} ${res.statusText}): ${res.data}`), 'HTTP_NOT_OK');

		return res.status;
	}

	const base = {
		ok: true,
		status: res.status,
		statusText: res.statusText,
		response: res,
		res,
	};

	if (res.headers['content-type'].includes('application/json') && typeof res.data === 'object') {
		return {
			...base,
			data: res.data,
		};
	}

	if (!options.extract) {
		return base;
	}

	const contextOptions = {
		...defaultOptions,
		...customOptions,
		origin: url,
	};

	const context = options.selectAll
		? initAll(res.data, options.selectAll, contextOptions)
		: init(res.data, options.select, contextOptions);

	return {
		...base,
		context,
	};
}

async function get(url, options) {
	return request(url, null, options, 'GET');
}

async function post(url, body, options) {
	return request(url, body, options, 'POST');
}

module.exports = {
	configure,
	get,
	post,
	request,
	initialize: init,
	initializeAll: initAll,
	init,
	initAll,
	extractDate,
	extractDuration,
	extractTimestamp,
	formatDate,
	prefixUrl,
	options: configure,
	query: initQueryFns(queryFns),
};
