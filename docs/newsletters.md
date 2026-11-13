# Newsletters

## Newsletters (optional, disabled by default)

Admin-only broadcast feature for sending Markdown emails to contacts. Off by default — when disabled, `NewsletterModule` is not imported and its entities are not registered.

```ts
EscalatedModule.forRoot({
  appUrl: 'https://support.example.com',
  enableNewsletters: true,
  newsletters: {
    defaultFrom: 'hi@example.com',
    defaultTheme: 'default',
    rateLimitPerMinute: 60,
    trackingEnabled: true,
    brand: {
      name: 'Acme',
      accent: '#2563eb',
      physicalAddress: 'Acme Inc. · 123 Main St · Springfield USA',
    },
  },
  mail: {
    from: 'hi@example.com',
    transport: { service: 'postmark', auth: { user: '...', pass: '...' } },
  },
})
```

Schedule the dispatcher every minute. The cron tick is currently exposed via `NewsletterDispatcherService.dispatchBatch()` — wire it into your host's scheduler module (or call from a controller for testing):

```ts
@Cron(CronExpression.EVERY_MINUTE)
async runNewsletterDispatch() {
  await this.newsletterDispatcher.dispatchBatch();
}
```

Custom themes are Handlebars files placed in the directory pointed to by `newsletters.themesDir`. Each theme receives `subject`, `body` (pre-rendered HTML), `unsubscribe_url`, `view_in_browser_url`, and `brand.*`.
