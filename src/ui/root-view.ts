import type { EscalatedUiOptions, InertiaPageObject } from './ui-options';

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

/**
 * JSON that is safe inside a `<script>` element: no `</script>`, no HTML
 * comment openers, and no line separators that end a JS string early.
 */
export function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * A Ziggy-compatible `route(name, params)` for the shared components, built
 * from the `ziggy` prop. Installed only when the host has none. An unknown
 * name warns and yields `#` instead of throwing mid-render.
 */
export const ROUTE_HELPER = `(function () {
  if (typeof window.route === 'function') return;
  function table() {
    try {
      var el = document.querySelector('script[data-page]');
      var page = el ? JSON.parse(el.textContent) : JSON.parse(document.getElementById('app').dataset.page);
      return (page.props && page.props.ziggy) || {};
    } catch (e) { return {}; }
  }
  var ziggy = table();
  window.route = function (name, params) {
    var routes = (window.Ziggy && window.Ziggy.routes) || ziggy.routes || {};
    var route = routes[name];
    if (!route) {
      if (window.console) console.warn('[escalated] no route named ' + name);
      return '#';
    }
    var list = params == null ? [] : (Array.isArray(params) ? params.slice() : (typeof params === 'object' ? null : [params]));
    var query = {};
    if (list === null) { for (var k in params) query[k] = params[k]; }
    var uri = route.uri.replace(/\\{(\\w+)\\??\\}/g, function (_, key) {
      var value;
      if (list !== null) { value = list.shift(); }
      else { value = query[key]; delete query[key]; }
      if (value != null && typeof value === 'object') value = value.reference != null ? value.reference : value.id;
      return value == null ? '' : encodeURIComponent(value);
    }).replace(/\\/+$/, '');
    var search = Object.keys(query).filter(function (key) { return query[key] != null; })
      .map(function (key) { return encodeURIComponent(key) + '=' + encodeURIComponent(query[key]); }).join('&');
    return '/' + uri + (search ? '?' + search : '');
  };
})();`;

/** The document served on a first visit when the host gives no `ui.rootView`. */
export function defaultRootView(
  page: InertiaPageObject,
  ui: EscalatedUiOptions,
  appName = 'Escalated',
): string {
  const title = escapeHtml(ui.title ?? appName);
  const styles = (ui.styles ?? [])
    .map((href) => `<link rel="stylesheet" href="${escapeHtml(href)}">`)
    .join('\n    ');
  const scripts = (ui.scripts ?? [])
    .map((src) => `<script type="module" src="${escapeHtml(src)}"></script>`)
    .join('\n    ');
  const json = JSON.stringify(page);

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${title}</title>
    ${styles}
    ${ui.head ?? ''}
  </head>
  <body>
    <script data-page="app" type="application/json">${scriptJson(page)}</script>
    <div id="app" data-page="${escapeHtml(json)}"></div>
    <script>${ROUTE_HELPER}</script>
    ${scripts}
  </body>
</html>
`;
}
