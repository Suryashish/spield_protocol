/**
 * Re-exports the shared Learn-hub CSS so the prerender bundle can import it from
 * a scripts-local path. The canonical source is src/content/learn-css.ts, which
 * is ALSO used by the React runtime — so the static (crawler) HTML and the
 * client-rendered SPA pages look identical.
 */
export { LEARN_CSS } from '../src/content/learn-css';
