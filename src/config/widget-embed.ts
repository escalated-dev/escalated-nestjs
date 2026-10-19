/**
 * Request property set by `WidgetCorsMiddleware` when a widget request comes
 * from an allowed other site. Its value is that site's normalised origin.
 */
export const WIDGET_EMBED_ORIGIN = 'escalatedWidgetEmbedOrigin';

/**
 * The allowed embedding origin of a widget request, if it came from one. Such
 * a request is always handled as a guest.
 */
export function embedOrigin(request: any): string | undefined {
  const origin = request?.[WIDGET_EMBED_ORIGIN];
  return typeof origin === 'string' ? origin : undefined;
}
