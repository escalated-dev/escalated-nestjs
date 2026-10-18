# Dependency audit

Reviewed on 2026-10-18 against the committed package and lockfile.

## Compatible security updates

The Nest packages remain on the 11.x line, updated to 11.2.7. This takes the
backported Multer 2.4.0 fixes without mixing Nest 12 adapters with Nest 11 core.
Handlebars 4.7.10 addresses the reported template injection advisories;
Nodemailer 10.1.2 addresses the reported content-access, DNS-cache, address-parser
and per-message authorization issues. Engine.IO 6.6.11, fast-uri 3.1.8 and the
patched brace-expansion releases are also locked within upstream ranges.

The normal peer resolver needed six missing Chokidar/readdirp lock entries.
They are now present, and CI installs with `npm ci` and strict peer checking,
without `--legacy-peer-deps`. An empty Jest test selection now fails.

The mail tests use the real Nest mailer and `EmailService` with a local SMTP
fixture. They cover authentication, rendered ticket/reply bodies, signed reply
addresses, threading headers, BCC privacy, attachments and rejected recipients.
The Handlebars regression checks that a prototype's own constructor is denied;
it observes the lookup without executing generated code.

## Remaining security findings

The full npm audit decreased from 30 findings (including one critical) to 23
findings: three high and twenty moderate package/dependency-chain findings.
These all originate from two advisories with no patched published release:

- [`braces` GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm),
  through the Chokidar 3 watcher used by `nestjs-i18n`.
- [`sprintf-js` GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c),
  through the older YAML/argparse chain in Jest's NYC coverage configuration
  loader.

The full audit remains nonzero. No audit exceptions, package aliases, forced
downgrades or dismissed alerts are used. Track compatible upstream fixes or
replacements and rerun the full audit, build and test matrix when they become
available. Updating this library does not update every dependency owned by a
host application; hosts should also update their Nest HTTP adapters and audit
their own lockfiles.

## Held major updates and support work

- **Nest WebSockets 12 / platform-express 12 (#141, #140):** these require Nest 12
  common/core peers, whereas this package currently advertises Nest 10/11 and
  installs Nest 11 framework components. The isolated bumps fail before the
  integration tests can run. Plan the framework versions and CommonJS/ESM test
  support together; a test-runner workaround alone does not fix peer conflicts.
- **Nest TypeORM adapter 12 (#136):** adds ESM packaging and a Node 20.19 minimum.
  Its Jest imports fail under the current configuration. Validate the installed
  CommonJS package as well as the test runner before upgrading.
- **better-sqlite3 13 (#134):** requires Node 22 or newer. Its Node 20 job reports
  that mismatch and a native-worker crash. Keep the compatible 12.x line until
  the runtime support decision is made.
- **Existing Node support mismatch:** `engines.node` advertises `>=20`, but the
  existing `nestjs-i18n` 10.8.5 dependency requires Node 22. The compatible patch
  does not change the public engine declaration or hide that mismatch. Use a
  current patched Node 22+ release for development while the support policy is
  resolved. Passing functional tests on a Node release does not satisfy an
  upstream package's declared engine range.
- **Host compatibility matrix:** an installed tarball boots a real Nest 11 app
  with TypeORM 0.3 and SQLite, without Jest mocks. A fresh Nest 10.4.22 consumer
  fails strict dependency resolution when the mailer's optional Terminus peer
  selects 12.1.0, which requires Nest 11/12. Resolve the optional peer selection
  and framework-coupled dependencies before confirming Nest 10 support. The
  repository's primary development graph uses Nest 11 and TypeORM 1.1.1, and
  runtime WebSocket dependencies currently select Nest 11 components.
