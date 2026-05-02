# Local translation overrides

Drop framework-specific translation overrides here. Files placed in this tree win over the central `@escalated-dev/locale` package, key-by-key via deep merge.

## Layout

```
src/i18n/overrides/
  <lang>/
    <namespace>.json
```

Languages and namespaces should mirror what `@escalated-dev/locale` ships. For example, to override the Arabic translation of `messages.status.open`:

```
src/i18n/overrides/ar/messages.json
```

```json
{
  "status": {
    "open": "Custom Arabic open label"
  }
}
```

Only the keys you put in the override file are applied; everything else falls through to the central package.

## Precedence

The chained loader in `../chained-loader.ts` merges sources in this order (later wins):

1. `@escalated-dev/locale` — canonical translations shipped from the central repo.
2. `src/i18n/overrides/` — this directory; NestJS-plugin-specific overrides.
3. `EscalatedModuleOptions.i18nOverridesPath` — optional host-app override path passed at module init.

## When NOT to add an override here

If a translation is wrong or missing, fix it upstream in `escalated-dev/escalated-locale` so all 14 host plugins benefit. Use this directory only for genuine NestJS-specific copy.
