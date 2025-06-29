# dx-server

A modern, unopinionated, and performant Node.js server framework built on AsyncLocalStorage for elegant request/response handling without prop drilling.

[![npm version](https://img.shields.io/npm/v/dx-server.svg)](https://www.npmjs.com/package/dx-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

- 🚀 **Context-based architecture** - Access request/response from anywhere using AsyncLocalStorage
- 🔗 **Chainable middleware** - Elegant middleware composition with [jchain](https://www.npmjs.com/package/jchain)
- 🎯 **Type-safe** - Written in TypeScript with comprehensive type definitions
- 🔄 **Express compatible** - Use existing Express middleware and applications
- 📦 **Zero dependencies** - No runtime dependencies, all functionality built-in
- 🛡️ **Built-in body parsing** - JSON, text, URL-encoded, and raw body parsing with size limits
- 🗂️ **Static file serving** - Efficient static file handling with ETag support
- 🔀 **Modern routing** - URLPattern-based routing (not Express patterns)

## Installation

```bash
# npm
npm install dx-server jchain

# yarn
yarn add dx-server jchain

# pnpm
pnpm add dx-server jchain
```

### URLPattern Support

dx-server uses the [URLPattern API](https://developer.mozilla.org/en-US/docs/Web/API/URLPattern) for routing, which is natively supported in Node.js v23.8.0 and later.

**For Node.js < 23.8.0**, you need to install a polyfill:

```bash
npm install urlpattern-polyfill
```

Then import it before using dx-server:

```javascript
// Add this at the top of your entry file
import 'urlpattern-polyfill'

// Then import dx-server
import dxServer from 'dx-server'
```

To check if your runtime supports URLPattern natively:

```javascript
if (typeof URLPattern === 'undefined') {
  console.log('URLPattern not supported, polyfill required')
}
```


## Quick Start

### Basic Server

```javascript
import {Server} from 'node:http'
import chain from 'jchain'
import dxServer, {getReq, getRes, router, setHtml, setText} from 'dx-server'

new Server().on('request', (req, res) => chain(
  dxServer(req, res),
  async next => {
    try {
      // Access req/res from anywhere - no prop drilling!
      getRes().setHeader('Cache-Control', 'no-cache')
      console.log(getReq().method, getReq().url)
      await next()
    } catch (e) {
      console.error(e)
      setHtml('internal server error', {status: 500})
    }
  },
  router.get({
    '/'() {setHtml('hello world')},
    '/health'() {setText('ok')}
  }),
  () => setHtml('not found', {status: 404}),
)()).listen(3000, () => console.log('server is listening at 3000'))
```

### TypeScript Example

```typescript
import {Server} from 'node:http'
import chain from 'jchain'
import dxServer, {router, setJson, getJson} from 'dx-server'

interface User {
    id: number
    name: string
}

new Server().on('request', (req, res) => chain(
  dxServer(req, res),
  router.post({
    async '/api/users'() {
      const body = await getJson<{name: string}>()
      if (!body?.name) {
        setJson({error: 'Name required'}, {status: 400})
        return
      }
      const user: User = {id: 1, name: body.name}
      setJson(user, {status: 201})
    }
  }),
  () => setJson({error: 'Not found'}, {status: 404})
)()).listen(3000)
```

### Static File Server

```javascript
import {Server} from 'node:http'
import chain from 'jchain'
import dxServer, {chainStatic, setHtml} from 'dx-server'
import {resolve} from 'node:path'

new Server().on('request', (req, res) => chain(
  dxServer(req, res),
  chainStatic('/*', {
    root: resolve(import.meta.dirname, 'public'),
  }),
  () => setHtml('not found', {status: 404}),
)()).listen(3000)
```

### Production-Ready Server with Express Integration

This example requires: `npm install express morgan helmet cors`


```javascript
import {Server} from 'node:http'
import {promisify} from 'node:util'
import chain from 'jchain'
import dxServer, {
  getReq, getRes,
  getBuffer, getJson, getRaw, getText, getUrlEncoded, getQuery,
  setHtml, setJson, setText, setEmpty, setBuffer, setRedirect, setNodeStream, setWebStream, setFile,
  router, connectMiddlewares, chainStatic, makeDxContext
} from 'dx-server'
import {expressApp} from 'dx-server/express'
import express from 'express'
import morgan from 'morgan'

// it is best practice to create custom error class for non-system error
class ServerError extends Error {
  name = 'ServerError'

  constructor(message, status = 400, code = 'unknown') {
    super(message)
    this.status = status
    this.code = code
  }
}

const authContext = makeDxContext(async () => {
  if (getReq().headers.authorization) return {id: 1, name: 'joe (private)'}
})

const requireAuth = () => {
  if (!authContext.value) throw new ServerError('Unauthorized', 401, 'UNAUTHORIZED')
}

const serverChain = chain(
  next => {
    // this is the difference between express and dx-server
    // req, res can be accessed from anywhere via context which uses NodeJS's AsyncLocalStorage under the hood
    getRes().setHeader('Cache-Control', 'no-cache')
    return next() // must return or await
  },
  async next => {// global error catching for all following middlewares
    try {
      await next()
    } catch (e) {// only app error message should be shown to user
      if (e instanceof ServerError) setHtml(`${e.message} (code: ${e.code})`, {status: e.status})
      else {// report system error
        console.error(e)
        setHtml('internal server error (code: internal)', {status: 500})
      }
    }
  },
  connectMiddlewares(
    morgan('common'),
    // cors(),
  ),
  await expressApp(app => {// any express feature can be used. This requires express installed, with for e.g., `yarn add express`
    app.set('trust proxy', true)
    if (process.env.NODE_ENV !== 'production') app.set('json spaces', 2)
    app.use('/public', express.static('public'))
  }),
  authContext.chain(), // chain context will set the context value to authContext.value in every request
  router.post('/api/*', async ({next}) => {// example of catching error for all /api/* routes
    try {
      await next()
    } catch (e) {
      if (e instanceof ServerError) setJson({// only app error message should be shown to user
        error: e.message,
        code: e.code,
      }, {status: e.status})
      else {// report system error
        console.error(e)
        setJson({
          message: 'internal server error',
          code: 'internal'
        }, {status: 500})
      }
    }
  }),
  router.post({
    '/api/sample-public-api'() { // sample POST router
      setJson({name: 'joe'})
    },
    '/api/me'() { // sample private router
      requireAuth()
      setJson({name: authContext.value.name})
    },
  }),
  router.get('/', () => setHtml('ok')), // router.method() accepts 2 formats
  router.get('/health', () => setText('ok')),
  () => { // not found router
    throw new ServerError('Not found', 404, 'NOT_FOUND')
  },
)

const tcpServer = new Server()
  .on('request', async (req, res) => {
    try {
      await chain(
        dxServer(req, res, {jsonBeautify: process.env.NODE_ENV !== 'production'}), // basic dx-server context
        serverChain,
      )()
    } catch (e) {
      console.error(e)
      res.end()
    }
  })

await promisify(tcpServer.listen.bind(tcpServer))(3000)
console.log('server is listening at 3000')
```

## Core Concepts

### Context-Based Architecture

dx-server uses Node.js AsyncLocalStorage to provide request/response context globally, eliminating prop drilling:

```javascript
// Access request/response from anywhere
import {getReq, getRes} from 'dx-server'

function someDeepFunction() {
  const req = getReq()  // No need to pass req through multiple layers
  const res = getRes()
  res.setHeader('X-Custom', 'value')
}
```

### Lazy Body Parsing

Body parsing functions are asynchronous and cached per request:

```javascript
import {getJson, getText, getBuffer, getUrlEncoded} from 'dx-server'

// Async usage (lazy-loaded and cached)
const json = await getJson()
const text = await getText()

// Sync usage (requires chaining)
chain(
  getJson.chain({bodyLimit: 1024 * 1024}), // 1MB limit
  next => {
    console.log(getJson.value) // Access synchronously
    return next()
  }
)
```

### Custom Contexts

Create reusable context objects with `makeDxContext`:

```javascript
import {makeDxContext, getReq} from 'dx-server'

// Create auth context
const authContext = makeDxContext(async () => {
  const token = getReq().headers.authorization
  if (!token) return null
  return await validateToken(token) // Your validation logic
})

// Use in middleware
chain(
  authContext.chain(), // Initialize for all requests
  next => {
    if (!authContext.value) {
      setJson({error: 'Unauthorized'}, {status: 401})
      return
    }
    return next()
  }
)

```

## API Reference

### Main Exports

```javascript
import dxServer, {
  // Request/Response access
  getReq, getRes,
  
  // Request body parsers
  getBuffer, getJson, getRaw, getText, getUrlEncoded, getQuery,
  
  // Response setters
  setHtml, setJson, setText, setEmpty, setBuffer, setRedirect, 
  setNodeStream, setWebStream, setFile,
  
  // Utilities
  router, connectMiddlewares, chainStatic, makeDxContext
} from 'dx-server'

// Express integration (requires express installed)
import {expressApp, expressRouter} from 'dx-server/express'

// Low-level helpers
import {
  setBufferBodyDefaultOptions,
  bufferFromReq, jsonFromReq, rawFromReq, textFromReq, 
  urlEncodedFromReq, queryFromReq,
} from 'dx-server/helpers'
```

### Core Functions

#### Request/Response Access
- **`getReq()`** - Get the current request object
- **`getRes()`** - Get the current response object

#### Body Parsers
All body parsers are async, lazy-loaded, and cached per request:

- **`getJson(options?)`** - Parse JSON body (requires `Content-Type: application/json`)
- **`getText(options?)`** - Parse text body (requires `Content-Type: text/plain`)
- **`getBuffer(options?)`** - Get raw buffer
- **`getRaw(options?)`** - Get raw body (requires `Content-Type: application/octet-stream`)
- **`getUrlEncoded(options?)`** - Parse URL-encoded form (requires `Content-Type: application/x-www-form-urlencoded`)
- **`getQuery(options?)`** - Parse query string parameters

Options:
```typescript
{
  bodyLimit?: number      // Max body size in bytes (default: 100KB)
  urlEncodedParser?: (search: string) => any
  queryParser?: (search: string) => any
}
```

#### Response Setters
- **`setJson(data, {status?, headers?})`** - Send JSON response
- **`setHtml(html, {status?, headers?})`** - Send HTML response
- **`setText(text, {status?, headers?})`** - Send plain text
- **`setBuffer(buffer, {status?, headers?})`** - Send buffer
- **`setFile(path, options?)`** - Send file
- **`setNodeStream(stream, {status?, headers?})`** - Send Node.js stream
- **`setWebStream(stream, {status?, headers?})`** - Send Web stream
- **`setRedirect(url, {status?, headers?})`** - Redirect response
- **`setEmpty({status?, headers?})`** - Send empty response

#### Context Management
- **`makeDxContext(fn)`** - Create a custom context object
  ```javascript
  const ctx = makeDxContext(() => computeValue())
  
  // Access value
  await ctx()        // Lazy load
  ctx.value          // Sync access (after loading)
  ctx.get(req)       // Get for specific request
  
  // Set value
  ctx.value = newValue
  ctx.set(req, newValue)
  ```

#### Middleware Utilities
- **`connectMiddlewares(...middlewares)`** - Use Connect/Express middleware
- **`chainStatic(pattern, options)`** - Serve static files
  ```javascript
  chainStatic('/public/*', {
    root: '/path/to/files',
    getPathname(matched){return matched.pathname}, // take URLPattern matched object, epects to return the file path
  // the returned file path must be run through decodeURIComponent before returning
    dotfiles: 'deny',
    disableEtag: false,
    lastModified: true
  })
  ```

### Routing

dx-server uses [URLPattern API](https://developer.mozilla.org/en-US/docs/Web/API/URLPattern) for routing, which differs from Express patterns:

```javascript
import {router} from 'dx-server'

// Single route
router.get('/users/:id', ({matched}) => {
  const {id} = matched.pathname.groups
  setJson({userId: id})
})

// Multiple routes
router.post({
  '/api/users': () => { /* create user */ },
  '/api/users/:id': ({matched}) => { /* update user */ },
  '/api/users/:id/posts': ({matched}) => { /* get user posts */ }
})

// All HTTP methods supported
router.get(pattern, handler)
router.post(pattern, handler)
router.put(pattern, handler)
router.delete(pattern, handler)
router.patch(pattern, handler)
router.head(pattern, handler)
router.options(pattern, handler)
router.all(pattern, handler)  // Any method

// Custom method
router.method('CUSTOM', pattern, handler)

// With prefix option
router.get({
  '/users': listUsers,
  '/users/:id': getUser
}, {prefix: '/api'})  // Routes become /api/users, /api/users/:id
```

#### URLPattern vs Express Patterns

| Pattern | URLPattern | Express |
|---------|------------|---------|
| Wildcard | `/api/*` | `/api/*` or `/api/(.*)` |
| Optional trailing slash | `{/}?` | `/path/?` |
| Named params | `/:id` | `/:id` |
| Optional params | `/:id?` | `/:id?` |

**Important differences:**
- `'/foo'` matches `/foo` but NOT `/foo/`
- `'/foo/'` matches `/foo/` but NOT `/foo`
- Use `'/foo{/}?'` to match both

### Express Integration

dx-server seamlessly integrates with Express applications and middleware:

```javascript
import {expressApp, expressRouter} from 'dx-server/express'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'

chain(
  // Use entire Express app
  await expressApp(app => {
    app.set('trust proxy', true)
    app.set('json spaces', 2)
    app.use(helmet())
    app.use('/static', express.static('public'))
  }),
  
  // Or use Express router
  expressRouter(router => {
    router.use(cors())
    router.get('/legacy', (req, res) => {
      res.json({message: 'Express route'})
    })
  })
)
```

### Low-Level Helpers

Pure functions for custom implementations:

```javascript
import {
  setBufferBodyDefaultOptions,
  bufferFromReq, jsonFromReq, rawFromReq, 
  textFromReq, urlEncodedFromReq, queryFromReq
} from 'dx-server/helpers'

// Set global defaults
setBufferBodyDefaultOptions({
  bodyLimit: 10 * 1024 * 1024, // 10MB
  queryParser: (search) => myCustomParser(search)
})

// Use directly with req/res (no context required)
const json = await jsonFromReq(req, {bodyLimit: 1024})
const query = queryFromReq(req)
```

## Security Considerations

### Body Size Limits
Always set appropriate body size limits to prevent DoS attacks:

```javascript
chain(
  getJson.chain({bodyLimit: 1024 * 1024}), // 1MB limit
  // or globally:
  dxServer(req, res, {bodyLimit: 5 * 1024 * 1024}) // 5MB
)
```

### Error Handling
Never expose internal errors to clients:

```javascript
class AppError extends Error {
  constructor(message, status = 400, code = 'ERROR') {
    super(message)
    this.status = status
    this.code = code
  }
}

chain(
  async next => {
    try {
      await next()
    } catch (error) {
      if (error instanceof AppError) {
        setJson({error: error.message, code: error.code}, {status: error.status})
      } else {
        console.error(error) // Log for debugging
        setJson({error: 'Internal server error'}, {status: 500})
      }
    }
  }
)
```

### Input Validation
Always validate input data:

```javascript
router.post('/api/users', async () => {
  const data = await getJson()
  
  // Validate
  if (!data?.email || !isValidEmail(data.email)) {
    throw new AppError('Invalid email', 400, 'INVALID_EMAIL')
  }
  
  // Process...
})
```

### Security Headers
Use security middleware:

```javascript
import helmet from 'helmet'
import cors from 'cors'

chain(
  connectMiddlewares(
    helmet(),
    cors({
      origin: process.env.ALLOWED_ORIGINS?.split(','),
      credentials: true
    })
  )
)
```

## Advanced Examples

### File Upload with Busboy
```javascript
import busboy from 'busboy'

router.post('/upload', () => {
  const req = getReq()
  const bb = busboy({headers: req.headers, limits: {fileSize: 10 * 1024 * 1024}})
  
  bb.on('file', (name, file, info) => {
    // Handle file stream
  })
  
  req.pipe(bb)
})
```

### WebSocket Upgrade
```javascript
import {WebSocketServer} from 'ws'

const wss = new WebSocketServer({noServer: true})

server.on('upgrade', (request, socket, head) => {
  if (request.url === '/ws') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request)
    })
  }
})
```

### Rate Limiting
```javascript
import rateLimit from 'express-rate-limit'

chain(
  connectMiddlewares(
    rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100 // limit each IP to 100 requests per windowMs
    })
  )
)
```

## Performance Tips

1. **Use lazy body parsing** - Only parse bodies when needed
2. **Enable compression** at reverse proxy level (nginx, CDN)
3. **Use streaming** for large responses:
   ```javascript
   import {createReadStream} from 'fs'
   setNodeStream(createReadStream('large-file.pdf'))
   ```
4. **Cache contexts** that are expensive to compute
5. **Use `chainStatic` with proper cache headers** for static assets

## Migration from Express

```javascript
// Express
app.get('/users/:id', (req, res) => {
  const {id} = req.params
  res.json({userId: id})
})

// dx-server
router.get('/users/:id', ({matched}) => {
  const {id} = matched.pathname.groups
  setJson({userId: id})
})
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT © [Sang Tran](https://github.com/tranvansang)
