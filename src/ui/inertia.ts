/**
 * What a controller returns to render a screen or to redirect after a form.
 *
 * With `ui.enabled`, the Inertia interceptor turns these into real Inertia
 * responses (HTML on a first visit, the page JSON with `X-Inertia` after,
 * `303` redirects with flash data). Without it they serialise exactly as the
 * plain `{ component, props }` and `{ redirect }` objects they always were.
 */
export class InertiaPage {
  constructor(
    public readonly component: string,
    public readonly props: Record<string, unknown> = {},
  ) {}
}

export interface FlashData {
  success?: string;
  error?: string;
  [key: string]: unknown;
}

export class InertiaRedirect {
  /** Where to go. `null` means back to the page the request came from. */
  readonly redirect!: string | null;

  constructor(url: string | null, extra: Record<string, unknown> = {}) {
    Object.assign(this, { redirect: url, ...extra });
  }
}

/** A redirect back to the referring page, falling back to `fallback`. */
export class InertiaBack extends InertiaRedirect {
  constructor(
    readonly fallback: string,
    readonly flash: FlashData = {},
    readonly errors: Record<string, string> = {},
  ) {
    super(null);
  }

  toJSON() {
    return { redirect: this.fallback, flash: this.flash, errors: this.errors };
  }
}

export function inertia(component: string, props: Record<string, unknown> = {}): InertiaPage {
  return new InertiaPage(component, props);
}

export function redirect(url: string, extra: Record<string, unknown> = {}): InertiaRedirect {
  return new InertiaRedirect(url, extra);
}

export function back(fallback: string, flash: FlashData = {}): InertiaBack {
  return new InertiaBack(fallback, flash);
}
