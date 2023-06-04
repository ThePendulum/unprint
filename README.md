# unprint
unprint is a web scraping utility built around JSDOM, providing convenience methods for quickly extracting common data types.

## Install
`npm install unprint`

## Usage
`const unprint = require('unprint');`

### Global options
```
unprint.options({
	headers: {
		'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/106.0.0.0 Safari/537.36'
	},
})
```

### Querying
For optimal flexibility, unprint query methods can be used with or without initialization. If you already have access to DOM elements using another library or unprint instance, you can query it by using the uninitialized `query` methods provided directly from the library, and passing the element as the first argument, as such:

`unprint.query.element(element, 'h1#title')` // HTMLHeadingElement

Both `unprint.get()` and `unprint.init()` return its `query` methods pre-initialized, removing the element argument in favor of the element retrieved or received. Initialized query methods therefore will *not* accept a custom element, usually expecting the selector as the first argument instead.

```javascript
const result = await unprint.get('http://localhot:3101/html');
const { query } = result.context;

query.element('h1#title'); // HTMLHeadingElement
```

```javascript
const result = await fetch('http://localhot:3101/html');
const body = await res.text();
const { query } = await unprint.init(body);

query.element('h1#title'); // HTMLHeadingElement
```

**From here on, the query methods will be described in their initialized form.** The API for the *uninitialized* methods is identical, except for the element passed as the first argument

#### Selector
The selector can be a CSS selector, an XPath selector starting with `/`, or an array of either or both acting as fallbacks. If the selector is falsy, the input element will be used.

#### Querying multiple elements
Most methods can be used in plural, returning an array of results, i.e. `query.elements()`, `query.dates()`.

#### Query an element
* `query.element([selector], [options])`

Returns the element node directly.

#### Query an attribute
`query.attribute(selector, attribute, [options])` or `query.attr()`

Return the contents of an attribute. Alias for `query.element([selector], { attribute: [attribute] })`.

#### Query existence
`query.exists(selector, [options])`

Return the presence of an element as a boolean.

#### Query count
`query.count(selector, [options])`

Return the number of elements that match the selector.

#### Query the content
`query.content([selector], [options])`

Return the text contents of an element (`.textContent`).

#### Query a number
`query.number([selector], [options])`

Options
* `match`: The regular expression to use to extract a number from text, default `/\d+(\.\d+)?/` for decimal numbers.
* `matchIndex`: The index of the match result, useful for expressions containing groups or a global flag, default `0`.

Return the contents of the element or attribute as a Number primitive.

#### Query the HTML
`query.content([selector], [options])`

Return the HTML contents of an element (`.innerHTML`).

#### Query a URL
`query.url([selector], [options])`

Options
* `origin`: The hostname to prefix when it is not included in the URL (`/path`).
* `protocol`: The protocol to use when it is not included in the URL (`:www.example.com`, default `http`).

Returns the `href` from an anchor element (or any other specified target) as a string.

#### Query an image
`query.image([selector], [options])` or `query.img()`

Options:
* All options supported by `query.url()`.

Returns the `src` from an image element (or any other specified target) as a string.

#### Query a dataset
`query.dataset(selector, property, [options])` or `query.data()`

Return the contents of a `data-` attribute.

#### Query a source set
`query.sourceSet([selector], [options])` or `query.srcSet()`

Options:
* `includeDescriptor`: Produce an array of `{ descriptor, url }` instead of URL strings.
* All options supported by `query.url()`.

Returns an array of media URLs from the `srcset` of an media element as strings sorted by their descriptor from large to small.

#### Query a video
`query.video([selector], [options])`

Options:
* All options supported by `query.url()`.

Returns the `src` from an video source element (or any other specified target) as a string.

#### Query a date
`query.date(selector, format, [options])`

Arguments
* `format` (string, array): The input format as a string or array of strings described by the [Moment.js docs](https://momentjs.com/docs/#/displaying/format/).

Options
* `match` (RegExp): The text to extract before attempting to parse it as a date. The default expression will attempt to extract any of 01-01-1970, 1970-01-01, 01/01/1970 or January 1, 1970 with optional 00:00[:00] time.
* `timezone` (string): The name of the input timezone, defaults to 'UTC'.

Returns a Date object.

#### Query a duration
`query.duration(selector, format, [options])` or `query.dur`

Options
* `match` (RegExp): The text to extract before attempting to parse it as a duration. The default expression will attempt to extract `(hh:)mm:ss` and `PT##H##M##S`.

Returns the duration in seconds as a number.

#### Query JSON
`query.json([selector], [options])`

Returns the parsed JSON content of an element as an object.

### HTTP request
* `unprint.get(url, [options])`
* `unprint.post(url, body, [options])`

Options
* `select`: Pre-query and initialize a specific element on the page
* `selectAll`: Pre-query and initialize multiple specific element on the page

Returns
```javascript
{
	context: {				// using select or no option
		query,				// (object)		unprint querying methods
	},
	context: [{				// using selectAll
		query,
	}],
	html,				// (string)		HTML body
	data,				// (object)		parsed JSON response
	status,				// (number)		HTTP status code
	ok,					// (boolean)	status code >= 200 and < 300
	response,			// (object)		the original axios response object, alias 'res'
	res,				// (object)		alias for 'response'
}
```
