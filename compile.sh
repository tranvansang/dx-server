rm -rf cjs esm \
&& (yarn tsc --project tsconfig.cjs.json || true)\
&& (yarn tsc --project tsconfig.esm.json || true) \
&& echo '{
	"type": "module"
}' > esm/package.json

