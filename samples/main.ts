import {Server} from 'node:http'
import chain from 'jchain'
import dxServer, {chainStatic, router, setFile, setHtml} from '../src/index.ts'
import {resolve} from 'node:path'

new Server().on('request', (req, res) => chain(
	dxServer(req, res),
	router.get('/test', () => setFile(resolve(import.meta.dirname, 'public/dummy.pdf'))),
	chainStatic('/*', {
		root: resolve(import.meta.dirname, 'public'),
	}),
	() => setHtml('not found', {status: 404}),
)()).listen(3000, () => console.log('Server is running at http://localhost:3000'))
