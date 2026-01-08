'use strict';

const { JSDOM, VirtualConsole } = require('jsdom');
const { chromium } = require('patchright');
const EventEmitter = require('events');
const undici = require('undici');
const qs = require('node:querystring');
const cookie = require('cookie');
const Bottleneck = require('bottleneck');
const moment = require('moment-timezone');
const merge = require('deepmerge');
const hashObject = require('object-hash');
const srcset = require('srcset');

const settings = {
	throwErrors: false,
	logErrors: true,
	requestTimeout: 30000,
	userAgent: 'unprint',
	limits: {
		default: {
			interval: 10,
			concurrency: 10,
		},
		browser: {
			interval: 20,
			concurrency: 5,
		},
	},
};

const virtualConsole = new VirtualConsole();
const { window: globalWindow } = new JSDOM('', { virtualConsole });

let globalOptions = {
	...settings,
};

const events = new EventEmitter();

function configure(newOptions) {
	globalOptions = merge(globalOptions, newOptions);
}

function handleError(error, code) {
	if (globalOptions.logErrors) {
		console.error(`unprint encountered an error (${code}): ${error.message}`);
	}

	if (globalOptions.throwErrors) {
		throw Object.assign(error, { code });
	}

	return null;
}

virtualConsole.on('error', (message) => handleError(message, 'JSDOM'));
virtualConsole.on('jsdomError', (message) => handleError(message, 'JSDOM'));

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

	if (selector.startsWith('/') || selector.startsWith('(')) {
		// XPath selector, . prefix ensures selector is relative to current node, won't work for deeper selections
		const iterator = globalWindow.document.evaluate(selector.replace(/^\//, './').replace(/^\(\//, '(./'), context.element, null, globalWindow.XPathResult.ORDERED_NODE_ITERATOR_TYPE, null);

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

function queryElements(context, selectors, customOptions = {}) {
	if (!selectors) {
		return context.element;
	}

	const options = customOptions;
	const targets = [].concat(selectors).reduce((acc, selector) => acc.concat(getElements(context, selector, false)), []).filter(Boolean);

	if (options.filterDuplicates === false) {
		return targets || [];
	}

	// findIndex always finds first index, if current index is not the first index, it's a dupe
	return targets.filter((target, index, array) => index === array.findIndex((dupe) => target === dupe));
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
		const attribute = options.forceGetAttribute
			? element.getAttribute(attributeKey)
			: element[attributeKey] || element.getAttribute(attributeKey);

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
	const options = {
		...context.options,
		trim: true,
		...customOptions,
	};

	const target = queryElement(context, selector, options);

	return extractContent(target, options);
}

function queryContents(context, selector, customOptions) {
	const options = {
		...context.options,
		trim: true,
		filter: true,
		...customOptions,
	};

	const targets = queryElements(context, selector, options);
	const extractedContents = targets.map((target) => extractContent(target, options));

	if (options.filter) {
		return extractedContents.filter(Boolean);
	}

	return extractedContents;
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

	if (target) {
		return target.dataset[dataAttribute];
	}

	return null;
}

function queryDatasets(context, selector, dataAttribute, customOptions) {
	const targets = queryElements(context, selector, customOptions);

	return targets.map((target) => target.dataset[dataAttribute]);
}

const defaultNumberRegexp = /\d+([.,]\d+)?/;

function extractNumber(rawNumberString, customOptions) {
	if (!rawNumberString) {
		return null;
	}

	const options = {
		match: defaultNumberRegexp,
		matchIndex: 0,
		separator: '.',
		...customOptions,
	};

	const numberString = options.separator === ','
		? rawNumberString.replace(',', '.')
		: rawNumberString.replace(',', '');

	if (numberString && options.match) {
		const number = Number(numberString.match(options.match)?.[options.matchIndex]);

		if (Number.isNaN(number)) {
			return null;
		}

		return number;
	}

	if (numberString) {
		const number = Number(numberString);

		if (Number.isNaN(number)) {
			return null;
		}

		return number;
	}

	return null;
}

function queryNumber(context, selector, customOptions) {
	const numberString = queryContent(context, selector, customOptions);

	return extractNumber(numberString, customOptions);
}

function queryNumbers(context, selector, customOptions) {
	const options = {
		filter: true,
		...customOptions,
	};

	const numberStrings = queryContents(context, selector, customOptions);

	if (!numberStrings) {
		return null;
	}

	const extractedNumbers = numberStrings.map((numberString) => extractNumber(numberString, customOptions));

	if (options.filter) {
		return extractedNumbers.filter(Boolean);
	}

	return extractedNumbers;
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

	const options = {
		protocol: 'https',
		...customOptions,
	};

	if (/^http/.test(urlPath)) {
		// this is already a complete URL
		return urlPath;
	}

	if (options.protocol && /^\/\//.test(urlPath)) {
		return `${options.protocol.replace(/:$/, '')}:${urlPath}`; // allow protocol to be defined either as 'https' or 'https:'
	}

	if (!originUrl) {
		return urlPath;
	}

	const { origin, protocol } = new URL(originUrl);

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
		forceGetAttribute: true, // don't get origin URL when empty
		...customOptions,
	};

	const url = queryContent(context, selector, options);

	return prefixUrl(url, options.origin, customOptions);
}

function queryUrls(context, selector = 'a', customOptions) {
	const options = {
		...context.options,
		attribute: 'href',
		forceGetAttribute: true, // don't get origin URL when empty
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
		forceGetAttribute: true, // don't get origin URL when empty
	};

	const imageUrl = getImageUrl(context, selector, options);

	return prefixUrl(imageUrl, options.origin, options);
}

function queryImages(context, selector = 'img', customOptions) {
	const options = {
		...context.options,
		...customOptions,
		forceGetAttribute: true, // don't get origin URL when empty
	};

	const imageUrls = getImageUrls(context, selector, options);

	return imageUrls.map((imageUrl) => prefixUrl(imageUrl, options.origin, options));
}

function getSourceSetDescriptor(source) {
	if (source.width) {
		return `${source.width}w`;
	}

	if (source.height) {
		return `${source.height}w`;
	}

	if (source.density) {
		return `${source.density}x`;
	}

	return 'fallback';
}

function extractSourceSet(sourceSet, customOptions) {
	if (!sourceSet) {
		return null;
	}

	const sources = srcset.parse(sourceSet)
		.map((source) => {
			if (source.url) {
				return {
					...source,
					descriptor: getSourceSetDescriptor(source),
					url: prefixUrl(source.url, customOptions.origin, customOptions.protocol),
				};
			}

			return null;
		})
		.filter(Boolean)
		.sort((sourceA, sourceB) => {
			if (customOptions.sort === false) {
				return 0;
			}

			if (sourceB.description === 'fallback') {
				return -1;
			}

			if (sourceA.width && sourceB.width && sourceA.width > sourceB.width) {
				return -1;
			}

			if (sourceA.height && sourceB.height && sourceA.height > sourceB.height) {
				return -1;
			}

			if (sourceA.width && sourceB.width && sourceA.width < sourceB.width) {
				return 1;
			}

			if (sourceA.height && sourceB.height && sourceA.height < sourceB.height) {
				return 1;
			}

			return 0;
		});

	if (customOptions.includeDescriptor) {
		return sources.map((source) => ({
			...source,
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

function removeStyleFunctionSpaces(el) {
	// jsdom appears to have a bug where it ignores inline CSS attributes set to a function() containing spaces, e.g. url( image.png )
	el.setAttribute('style', el.getAttribute('style')
		.replace(/\(\s+(.*)\s+\)/g, (match, cssArgs) => `(${cssArgs})`)
		.replace(/\)[\w\s/-]+;/g, ');'));
}

function queryStyle(context, selector, customOptions) {
	const options = {
		attribute: 'style',
		attemptBugfix: true,
		...customOptions,
	};

	const element = queryElement(context, selector, options);

	if (element) {
		if (options.attemptBugfix) {
			removeStyleFunctionSpaces(element, options);
		}

		if (element.style) {
			return options.styleAttribute
				? element.style.getPropertyValue(options.styleAttribute)
				: element.style._values;
		}
	}

	return null;
}

function queryStyles(context, selector, customOptions) {
	const options = {
		...customOptions,
		attribute: 'style',
	};

	const elStyles = queryElements(context, selector, options).map((element) => {
		removeStyleFunctionSpaces(element);

		if (element.style) {
			return options.styleAttribute
				? element.style.getPropertyValue(options.styleAttribute)
				: element.style._values;
		}

		return null;
	});

	return elStyles.filter(Boolean);
}

function queryStyleUrl(context, selector, styleAttribute, customOptions) {
	const options = {
		styleAttribute,
		...customOptions,
	};

	const style = queryStyle(context, selector, options);

	if (!style) {
		return null;
	}

	const url = style.match(/url\(['"]?(.*)['"]?\)/)?.[1];

	return url;
}

function queryStyleUrls(context, selector, styleAttribute, customOptions) {
	const options = {
		styleAttribute,
		...customOptions,
	};

	const styles = queryStyles(context, selector, options);
	const urls = styles.map((style) => style.match(/url\(['"]?(.*)['"]?\)/)?.[1])?.filter(Boolean);

	return urls;
}

function queryBackground(context, selector, customOptions) {
	return queryStyleUrl(context, selector, 'background-image', customOptions);
}

function queryBackgrounds(context, selector, customOptions) {
	return queryStyleUrls(context, selector, 'background-image', customOptions);
}

function queryVideo(context, selector = 'video source', customOptions) {
	const options = {
		...context.options,
		attribute: 'src',
		forceGetAttribute: true, // don't get origin URL when empty
		...customOptions,
	};

	const videoUrl = queryContent(context, selector, options);

	return prefixUrl(videoUrl, options.origin, options);
}

function queryVideos(context, selector = 'video source', customOptions) {
	const options = {
		...context.options,
		attribute: 'src',
		forceGetAttribute: true, // don't get origin URL when empty
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
		match: /((\d{1,4}[/-]\d{1,2}[/-]\d{1,4})|(\w+\s+\d{1,2},?\s+\d{4}))((T|\s+)\d{1,2}:\d{2}(:\d{2})?)?/g, // matches any of 01-01-1970, 1970-01-01 and January 1, 1970 with optional 00:00[:00] time
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
	const timestampMatch = durationString?.match(/(\d+\s*H)?.*(\d+\s*M)?.*(\d+\s*(S|$))?/i)?.[0];

	if (timestampMatch) {
		const hours = timestampMatch.match(/(\d+)\s*H/i)?.[1] || 0;
		const minutes = timestampMatch.match(/(\d+)\s*M/i)?.[1] || 0;
		const seconds = timestampMatch.match(/(\d+)\s*(s(ec\w*)?)|$/i)?.[1] || 0;

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
	background: queryBackground,
	backgrounds: queryBackgrounds,
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
	style: queryStyle,
	styles: queryStyles,
	styleUrl: queryStyleUrl,
	styleUrls: queryStyleUrls,
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
		return Object.fromEntries(Object.entries(fns).map(([key, fn]) => [key, (...args) => {
			events.emit('query', {
				key,
				args,
				origin: context.options.origin,
			});

			return fn(context, ...args);
		}]));
	}

	// context is passed directly to query method
	return Object.fromEntries(Object.entries(fns).map(([key, fn]) => [key, (...args) => {
		// first argument is already an unprint context. this seems like a convoluted approach, but there is little reason not to allow it
		if (args[0]?.isUnprint) {
			events.emit('query', {
				key,
				args,
			});

			return fn(...args);
		}

		// most common usage is to pass an element directly, convert to context
		if (isDomObject(args[0])) {
			const element = args[0];

			events.emit('query', {
				key,
				args,
			});

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

const limiters = {
	default: new Bottleneck(),
};

function getLimiterValue(prop, options, hostname) {
	if (options[prop] !== undefined) {
		return options[prop];
	}

	if (options.limits[hostname]?.enable !== false && options.limits[hostname]?.[prop] !== undefined) {
		return options.limits[hostname][prop];
	}

	return options.limits[options?.limiter || 'default'][prop];
}

function getLimiter(url, options) {
	const { hostname } = new URL(url);

	const interval = getLimiterValue('interval', options, hostname);
	const concurrency = getLimiterValue('concurrency', options, hostname);

	if (!limiters[interval]?.[concurrency]) {
		limiters[interval] = limiters[interval] || {};

		limiters[interval][concurrency] = new Bottleneck({
			minTime: interval,
			maxConcurrent: concurrency,
			timeout: options.timeout + 10000, // timeout 10 seconds after axious should
		});
	}

	return {
		limiter: limiters[interval][concurrency],
		interval,
		concurrency,
	};
}

function getCookie(options) {
	const headerCookieData = options.headers?.cookie || options.headers?.Cookie || null;
	const headerCookies = headerCookieData && cookie.parseCookie(headerCookieData);

	if (typeof options.cookies === 'object') {
		return cookie.stringifyCookie({
			...headerCookies,
			...options.cookies,
		});
	}

	if (typeof options.cookies === 'string') {
		const cookieData = cookie.parseCookie(options.cookies);

		return cookie.stringifyCookie({
			...headerCookies,
			...cookieData,
		});
	}

	return headerCookieData;
}

function curateHeaders(headers, options) {
	if (headers && options.defaultHeaders !== false) {
		return Object.fromEntries(Object.entries(headers)
			.map(([key, value]) => [key.toLowerCase(), value])
			.filter(([_key, value]) => value !== null));
	}

	return headers;
}

function curateResponse(res, data, options, { url, control, customOptions }) {
	const base = {
		ok: true,
		data,
		status: res.statusCode || res.status,
		statusText: res.statusText,
		headers: res.headers,
		response: res,
		res,
		control,
	};

	if (['application/json', 'application/javascript'].some((type) => {
		if (typeof res.headers.get === 'function') {
			return res.headers.get('content-type')?.includes(type);
		}

		return res.headers['content-type']?.includes(type);
	})) {
		if (typeof data === 'object') {
			return {
				...base,
				data,
			};
		}

		try {
			return {
				...base,
				data: JSON.parse(data),
			};
		} catch (error) {
			return {
				...base,
				data,
			};
		}
	}

	if (!options.extract) {
		return base;
	}

	const contextOptions = {
		...customOptions,
		origin: url,
	};

	const context = options.selectAll
		? initAll(data, options.selectAll, contextOptions)
		: init(data, options.select, contextOptions);

	return {
		...base,
		context,
	};
}

/* eslint-disable no-param-reassign */
const clients = new Map();

/* eslint-enable no-param-reassign */
async function getBrowserInstance(scope, options, useProxy = false) {
	const scopeKey = `${scope}_${useProxy ? 'proxy' : 'direct'}_${options.browser ? hashObject(options.browser) : 'default'}_${options.context ? hashObject(options.context) : 'default'}`;

	if (clients.has(scopeKey)) {
		const client = clients.get(scopeKey);

		client.uses += 1;

		if (client.uses >= (options.clientRetirement || 20)) {
			client.retired = true;
			clients.delete(scopeKey);
		}

		await client.launchers;

		return client;
	}

	// if we await here, we create a race condition, and a second call to getBrowserInstance would launch another browser that will overwrite the first one
	const browserLauncher = chromium.launch({
		headless: true,
		...options.browser,
	});

	const contextLauncher = browserLauncher.then((browser) => browser.newContext({
		userAgent: options.browserUserAgent || options.userAgent,
		...options.context,
		...(useProxy && {
			proxy: {
				server: `${options.proxy.host}:${options.proxy.port}`,
			},
		}),
	}));

	const launchers = Promise.all([browserLauncher, contextLauncher]);

	const client = {
		key: scopeKey,
		launchers,
		active: 0,
		uses: 1,
		retired: false,
	};

	if (scope) {
		clients.set(scopeKey, client);
	}

	client.browser = await browserLauncher;
	client.context = await contextLauncher;

	return client;
}

async function closeAllBrowsers() {
	await Promise.all(Array.from(clients.values()).map(async (client) => client.browser.close()));
}

async function closeBrowser(client, options) {
	if (options.client === null // this browser is single-use
		|| (client.retired && client.active === 0)) { // this browser is retired to minimize garbage build-up
		// this browser won't be reused
		await client.browser.close();
	}
}

function getAgent(options, url) {
	const { hostname } = new URL(url);

	if (options.proxy
		&& options.proxy.enable !== false
		&& (options.useProxy // defined locally
		|| options.proxy.use // defined globally
		|| options.proxy.hostnames?.includes(hostname))
	) {
		return new undici.ProxyAgent(`http://${options.proxy.host}:${options.proxy.port}/`, {
			bodyTimeout: options.timeout,
			interceptors: { // only applies to fetch
				Agent: [
					undici.interceptors.redirect({
						maxRedirection: options.followRedirects ? options.maxRedirects : 0,
					}),
				],
			},
		});
	}

	return new undici.Agent({
		bodyTimeout: options.timeout,
		interceptors: { // only applies to fetch
			Agent: [
				undici.interceptors.redirect({
					maxRedirection: options.followRedirects ? options.maxRedirects : 0,
				}),
			],
		},
	});
}

async function browserRequest(url, customOptions = {}) {
	const options = merge.all([{
		timeout: 10000,
		extract: true,
		client: 'main',
		limiter: 'browser',
		url,
	}, globalOptions, customOptions]);

	const { limiter, interval, concurrency } = getLimiter(url, options);
	const agent = getAgent(options, url);

	const feedbackBase = {
		url,
		method: 'get',
		interval,
		concurrency,
		isProxied: agent instanceof undici.ProxyAgent,
		isBrowser: true,
		options,
	};

	events.emit('requestInit', feedbackBase);

	return limiter.schedule(async () => {
		const client = await getBrowserInstance(options.client, options, agent instanceof undici.ProxyAgent);

		client.active += 1;

		const page = await client.context.newPage();

		await page.route(url, async (route) => {
			const headers = route.request().headers();

			route.continue({
				headers: curateHeaders({
					...headers,
					'user-agent': options.browserUserAgent || options.userAgent,
					...options.headers,
					cookie: getCookie(options),
				}, options),
			});
		});

		const res = await page.goto(url, {
			...options.page,
		}).catch((error) => error);

		if (res instanceof Error) {
			return {
				ok: false,
				status: null,
				statusText: res.name,
			};
		}

		const status = res.status();
		const statusText = res.statusText();
		const headers = await res.allHeaders();

		if (!(status >= 200 && status < 300)) {
			const data = await page.content();

			handleError(new Error(`HTTP response from ${url} not OK (${status} ${statusText}): ${data}`), 'HTTP_NOT_OK');

			events.emit('requestError', {
				...feedbackBase,
				status,
				statusText,
			});

			client.active -= 1;

			await closeBrowser(client, options);

			return {
				ok: false,
				status,
				statusText,
				headers,
				response: res,
				res,
			};
		}

		events.emit('requestSuccess', feedbackBase);

		await page.waitForLoadState();

		let control = null;

		if (customOptions.control) {
			try {
				control = await customOptions.control(page, client);
			} catch (error) {
				client.active -= 1;

				await closeBrowser(client, options);

				return {
					ok: false,
					controlError: error.message,
					status,
					statusText,
					headers,
					response: res,
					res,
				};
			}
		}

		events.emit('controlSuccess', feedbackBase);

		const data = await page.content();

		await page.close();

		events.emit('requestSuccess', {
			...feedbackBase,
			status,
			statusText,
		});

		client.active -= 1;

		await closeBrowser(client, options);

		return curateResponse({
			status,
			statusText,
			headers,
		}, data, options, {
			url,
			customOptions,
			control,
		});
	});
}

function curateRequestBody(body) {
	if (!body) {
		return { body };
	}

	if (body instanceof undici.FormData) {
		return {
			body: qs.stringify(body),
			headers: {
				'content-type': 'application/x-www-form-urlencoded',
			},
		};
	}

	if (typeof body === 'object') {
		return {
			body: JSON.stringify(body),
			headers: {
				'content-type': 'application/json',
			},
		};
	}

	return { body };
}

async function request(url, body, customOptions = {}, method = 'GET', redirects = 0) {
	const options = merge.all([{
		interface: 'fetch', // fetch or request
		timeout: 10000,
		extract: true,
		followRedirects: true,
		maxRedirects: 3,
		url,
	}, globalOptions, customOptions]);

	const { limiter, interval, concurrency } = getLimiter(url, options);

	const agent = getAgent(options, url);

	const feedbackBase = {
		url,
		method,
		interval,
		concurrency,
		isProxied: agent instanceof undici.ProxyAgent,
		isBrowser: false,
		options,
	};

	events.emit('requestInit', feedbackBase);

	const curatedBody = curateRequestBody(body);
	const curatedCookie = getCookie(options);

	const headers = curateHeaders({
		...curatedBody.headers,
		'user-agent': (options.interface === 'fetch' ? options.browserUserAgent : options.apiUserAgent) || options.userAgent,
		...options.headers,
		cookie: curatedCookie,
	}, options);

	const res = await limiter.schedule(async () => undici[options.interface](url, {
		dispatcher: agent,
		method,
		body: curatedBody.body,
		headers,
		signal: options.abortSignal,
	})).catch((error) => ({ // tends to happen when proxy can't reach host
		status: 500,
		statusText: 'Request aborted',
		async text() { return error.cause?.cause?.message || 'Request aborted'; },
	}));

	const status = res.statusCode || res.status;

	// fetch handles redirects internally, configured by agent/dispatcher, don't follow again
	if (options.interface === 'request'
		&& [301, 302, 303, 307, 308].includes(status)
		&& res.headers.location
		&& options.followRedirects
		&& redirects < options.maxRedirects
	) {
		const newUrl = new URL(res.headers.location, url).toString();

		return request(newUrl, body, options, method, redirects + 1);
	}

	const data = options.interface === 'fetch'
		? await res.text()
		: await res.body.text();

	if (!(status >= 200 && status < 300)) {
		handleError(new Error(`HTTP response from ${url} not OK (${status} ${res.statusText}): ${data}`), 'HTTP_NOT_OK');

		events.emit('requestError', {
			...feedbackBase,
			status,
			statusText: res.statusText,
		});

		return {
			ok: false,
			status,
			statusText: res.statusText,
			headers: res.headers,
			response: res,
			res,
		};
	}

	events.emit('requestSuccess', {
		...feedbackBase,
		status,
		statusText: res.statusText,
	});

	return curateResponse(res, data, options, { url, customOptions });
}

async function get(url, options) {
	return request(url, null, options, 'GET');
}

async function post(url, body, options) {
	return request(url, body, options, 'POST');
}

function on(trigger, fn) {
	events.on(trigger, fn);
}

function off(trigger, fn) {
	events.off(trigger, fn);
}

module.exports = {
	configure,
	on,
	off,
	events,
	get,
	post,
	request,
	browserRequest,
	browser: browserRequest,
	closeAllBrowsers,
	initialize: init,
	initializeAll: initAll,
	init,
	initAll,
	extractDate,
	extractDuration,
	extractNumber,
	extractTimestamp,
	formatDate,
	dateConstants: {
		ISO_8601: moment.ISO_8601,
		...moment.HTML5_FMT,
	},
	prefixUrl,
	options: configure,
	query: initQueryFns(queryFns),
};
