const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const npmCli = process.env.npm_execpath;
assert(npmCli && fs.existsSync(npmCli), 'Run this check with npm run test:package');
const root = path.resolve(__dirname, '..');
const temporaryParent = fs.realpathSync(os.tmpdir());
const directory = fs.mkdtempSync(path.join(temporaryParent, 'escalated-installed-package-'));
const marker = randomUUID();
fs.writeFileSync(path.join(directory, '.owned-runtime'), marker);
const allowed = new Set([
  'path',
  'home',
  'userprofile',
  'homedrive',
  'homepath',
  'systemroot',
  'windir',
  'comspec',
  'pathext',
  'appdata',
  'localappdata',
  'temp',
  'tmp',
  'programfiles',
  'programfiles(x86)',
  'programdata',
  'number_of_processors',
  'processor_architecture',
  'os',
]);
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => allowed.has(key.toLowerCase())),
);
Object.assign(env, { CI: '1', NODE_ENV: 'test' });

function run(command, args, cwd, capture = false) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    windowsHide: true,
    encoding: 'utf8',
    timeout: 600_000,
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} ${args.join(' ')} failed`);
  return result.stdout;
}

let passed = false;
try {
  run(process.execPath, [npmCli, 'run', 'build'], root);
  const packed = JSON.parse(
    run(process.execPath, [npmCli, 'pack', '--json', '--pack-destination', directory], root, true),
  )[0];
  const files = new Set(packed.files.map((file) => file.path));
  for (const required of ['dist/index.js', 'dist/index.d.ts', 'dist/escalated.module.js']) {
    assert(files.has(required), `Published package is missing ${required}`);
  }
  const consumer = path.join(directory, 'consumer');
  fs.mkdirSync(consumer);
  fs.writeFileSync(
    path.join(consumer, 'package.json'),
    JSON.stringify(
      {
        name: 'installed-escalated-consumer',
        version: '1.0.0',
        private: true,
        dependencies: {
          '@escalated-dev/escalated-nestjs': `file:${path.join(directory, packed.filename).replaceAll('\\', '/')}`,
          '@nestjs/common': '^11.2.7',
          '@nestjs/core': '^11.2.7',
          '@nestjs/platform-express': '^11.2.7',
          '@nestjs/testing': '^11.2.7',
          '@nestjs/typeorm': '^11.0.3',
          'better-sqlite3': '^12.11.1',
          'reflect-metadata': '^0.2.2',
          rxjs: '^7.8.2',
          typeorm: '^0.3.0',
        },
      },
      null,
      2,
    ),
  );
  run(
    process.execPath,
    [npmCli, 'install', '--engine-strict', '--strict-peer-deps', '--no-progress'],
    consumer,
  );
  fs.writeFileSync(
    path.join(consumer, 'boot.cjs'),
    `
require('reflect-metadata');
const assert = require('node:assert/strict');
const { Test } = require('@nestjs/testing');
const { TypeOrmModule } = require('@nestjs/typeorm');
const library = require('@escalated-dev/escalated-nestjs');
(async () => {
  let app;
  try {
    const module = await Test.createTestingModule({ imports: [
      TypeOrmModule.forRoot({ type: 'better-sqlite3', database: ':memory:', autoLoadEntities: true, synchronize: true }),
      library.EscalatedModule.forRoot({}),
    ] }).compile();
    app = module.createNestApplication();
    await app.init();
    assert(app.get(library.TicketService));
    console.log('PASS installed Nest 11 / TypeORM 0.3 package, without Jest mocks');
  } finally {
    if (app) await app.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
`,
  );
  run(process.execPath, [path.join(consumer, 'boot.cjs')], consumer);
  passed = true;
} finally {
  if (passed) {
    const resolved = fs.realpathSync(directory);
    assert.equal(path.dirname(resolved), temporaryParent);
    assert(path.basename(resolved).startsWith('escalated-installed-package-'));
    assert.equal(fs.readFileSync(path.join(resolved, '.owned-runtime'), 'utf8'), marker);
    fs.rmSync(resolved, { recursive: true });
  } else {
    console.error(`Installed-package check artifacts retained at ${directory}`);
  }
}
