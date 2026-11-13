# Development

## Development

```bash
git clone https://github.com/escalated-dev/escalated-nestjs.git
cd escalated-nestjs
npm ci
npm test -- --runInBand
npm run build
npm run lint
npm run format:check
npm run test:package
npm audit
```

Use a current patched Node 22 release for development (`.nvmrc` selects 22.x).
CI installs the committed lockfile with strict peer checking and runs the test
suite on Node 20, 22 and 24, plus the PostgreSQL/MySQL access and migration checks.
Node 20's existing upstream engine mismatch remains open; a functional test
pass does not establish engine compatibility. The full audit also reports the
remaining unpatched `braces` and `sprintf-js` findings described above.
