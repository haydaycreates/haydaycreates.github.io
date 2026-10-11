import { site } from '../site.config.js';

/**
 * /robots.txt — generated so the sitemap URL always matches your domain.
 *
 * The one private route is disallowed: /write/ is the writing desk. It has
 * nothing to offer a search engine, and it is also marked noindex in the HTML
 * and (on hosts that support headers) by a response header.
 */
export async function GET(context) {
  const base = (context.site?.href || site.url).replace(/\/$/, '');
  const body = `User-agent: *
Allow: /
Disallow: /write/

Sitemap: ${base}/sitemap.xml
`;
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
