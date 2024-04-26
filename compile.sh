rm -rf cjs esm \
&& (npx tsc --project tsconfig.cjs.json || true) \
&& (npx tsc --project tsconfig.esm.json || true) \
&& echo '{
	"type": "commonjs"
}' > cjs/package.json

