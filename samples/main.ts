import {Server} from 'node:http'
import chain from 'jchain'
import dxServer, {chainStatic, setHtml} from '../src'
import {resolve, dirname} from 'node:path'
import {fileURLToPath} from 'node:url'

new Server().on('request', (req, res) => chain(
	dxServer(req, res),
	chainStatic('/*', {
		root: resolve(dirname(fileURLToPath(import.meta.url)), 'public'),
	}),
	() => setHtml('not found', {status: 404}),
)()).listen(3000)
