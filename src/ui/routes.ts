/**
 * The named routes the shared components call through `route(name, params)`
 * (Laravel's Ziggy helper), with the URIs this package serves them at.
 *
 * Shared as the `ziggy` prop in the shape ziggy-js reads, so a host may use
 * ziggy-js; the default root view installs a small compatible `route()`.
 * A name the components call that is missing here has no screen behind it yet.
 */
export interface NamedRoute {
  uri: string;
  methods: string[];
}

const GET = ['GET', 'HEAD'];
const POST = ['POST'];
const PUT = ['PUT'];

export const ESCALATED_UI_PREFIX = 'escalated';

const routes: Record<string, NamedRoute> = {
  // Agent
  'escalated.agent.dashboard': { uri: 'escalated/agent', methods: GET },
  'escalated.agent.tickets.index': { uri: 'escalated/agent/tickets', methods: GET },
  'escalated.agent.tickets.show': { uri: 'escalated/agent/tickets/{ticket}', methods: GET },
  'escalated.agent.tickets.update': { uri: 'escalated/agent/tickets/{ticket}', methods: PUT },
  'escalated.agent.tickets.reply': { uri: 'escalated/agent/tickets/{ticket}/reply', methods: POST },
  'escalated.agent.tickets.note': { uri: 'escalated/agent/tickets/{ticket}/note', methods: POST },
  'escalated.agent.tickets.assign': {
    uri: 'escalated/agent/tickets/{ticket}/assign',
    methods: POST,
  },
  'escalated.agent.tickets.status': {
    uri: 'escalated/agent/tickets/{ticket}/status',
    methods: POST,
  },
  'escalated.agent.tickets.priority': {
    uri: 'escalated/agent/tickets/{ticket}/priority',
    methods: POST,
  },
  'escalated.agent.tickets.tags': { uri: 'escalated/agent/tickets/{ticket}/tags', methods: POST },
  'escalated.agent.tickets.department': {
    uri: 'escalated/agent/tickets/{ticket}/department',
    methods: POST,
  },
  'escalated.agent.tickets.macro': { uri: 'escalated/agent/tickets/{ticket}/macro', methods: POST },
  'escalated.agent.tickets.follow': {
    uri: 'escalated/agent/tickets/{ticket}/follow',
    methods: POST,
  },
  'escalated.agent.tickets.custom-action': {
    uri: 'escalated/agent/tickets/{ticket}/actions/{action}',
    methods: POST,
  },
};

/** Every named route the screens can call, keyed by name. */
export function escalatedRoutes(): Record<string, NamedRoute> {
  return routes;
}

/** The URL for a named route, like `route(name, params)` on the client. */
export function routeUrl(name: string, params: Record<string, string | number> = {}): string {
  const route = routes[name];
  if (!route) throw new Error(`Unknown Escalated route ${name}`);
  return (
    '/' +
    route.uri.replace(/\{(\w+)\??\}/g, (_, key: string) => encodeURIComponent(String(params[key])))
  );
}
