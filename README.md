# unprint
unprint is a web scraping utility built around JSDOM, providing convenience methods for quickly extracting common data types.

## Install
`npm install unprint`

## Usage
`const unprint = require('unprint');`

### Querying
For optimal flexibility, unprint query methods can be used with or without initialization. If you already have access to DOM elements using another library or unprint instance, you can query it by using the uninitialized `query` methods provided directly from the library, and passing the element as the first argument, as such:

`unprint.query.element(element, 'h1#title')` // HTMLHeadingElement

Both `http.get()` and `http.init()` return its `query` methods pre-initialized, removing the element argument in favor of the element retrieved or received. Initialized query methods therefore will *not* accept a custom element, usually expecting the selector as the first argument instead.

```javascript
const result = await unprint.get('http://localhot:3101/html');
result.context.query.element('h1#title'); // HTMLHeadingElement
```

```javascript
const result = await fetch('http://localhot:3101/html');
const body = await res.text();
const context = await unprint.init(body);

context.query.element('h1#title'); // HTMLHeadingElement
```

**From here on, the query methods will be described in their initialized form.** The API for the *uninitialized* methods is identical, except for the element passed as the first argument

#### Selector
The selector can be a CSS selector, an XPath selector starting with `//`, or an array of either or both acting as fallbacks. If the selector is falsy, the input element will be used.

#### Query an element
* `query.element([selector], [options])`

Returns the element node directly.

#### Query a date
`query.date([selector], format, [options])`

Arguments
* `format` (string, array): The input format as a string or array of strings described by the [Moment.js docs](https://momentjs.com/docs/#/displaying/format/).

Options
* `match (RegExp): The text to extract before attempting to parse it as a date. The default expression will attempt to extract any of 01-01-1970, 1970-01-01, 01/01/1970 or January 1, 1970 with optional 00:00[:00] time.
* `timezone` (string): The name of the input timezone, defaults to 'UTC'.

Returns a Date object.

#### Querying multiple elements
Most methods can be used in plural, returning an array of results, i.e. `query.elements()`, `query.dates()`.

### HTTP request
`unprint.get(url, [options])`
`unprint.post(url, body, [options])`

Options
* `select`: Pre-query and initialize a specific element on the page
* `selectAll`: Pre-query and initialize multiple specific element on the page

Returns
```javascript
{
	query,				// (object)		unprint querying methods
	html,				// (string)		HTML body
	data,				// (object)		parsed JSON response
	status,				// (number)		HTTP status code
	ok,					// (boolean)	status code >= 200 and < 300
	response,			// (object)		the original axios response object, alias 'res'
	res,				// (object)		alias for 'response'
}
```
