// Aggregate visit counter: hour × page × referrer host × kind. No IP, no cookie, no raw User-Agent is stored.

const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|whatsapp|telegram|discord|slack|curl|wget|python|go-http|node-fetch|axios|headless|lighthouse|monitor|uptime/i;
const X_HOSTS = new Set(['x.com', 't.co', 'twitter.com', 'mobile.twitter.com', 'mobile.x.com']);

export function pageOf(path) {
  if (path === '/') return '/';
  if (path === '/llms.txt') return '/llms.txt';
  if (path.startsWith('/api')) return 'api';
  const top = path.split('/')[1];
  if (['agents', 'platforms', 'docs', 'token'].includes(top)) return '/' + top;
  if (top === 'agent') return '/agent/:id';
  if (top === 'platform') return '/platform/:host';
  return null; // static files, favicons, unknown paths are not counted
}

export function refOf(referer, ownHost) {
  if (!referer) return 'direct';
  let host;
  try { host = new URL(referer).hostname.toLowerCase(); } catch { return 'other'; }
  if (host === ownHost || host === 'www.' + ownHost) return 'internal';
  if (X_HOSTS.has(host)) return 'x';
  return host.replace(/^www\./, '').slice(0, 60);
}

export const kindOf = (ua) => (!ua || BOT.test(ua) ? 'bot' : 'browser');

export function makeVisits(db, { ownHost }) {
  const add = db.prepare(`INSERT INTO visits(hour, page, ref, kind, n) VALUES(?,?,?,?,1)
    ON CONFLICT(hour, page, ref, kind) DO UPDATE SET n = n + 1`);
  return {
    record(req, statusCode) {
      if (req.method !== 'GET' || statusCode >= 500 || req.headers['x-rc-internal']) return;
      const page = pageOf(req.url.split('?')[0]);
      if (!page || page === 'api' && req.url.startsWith('/api/health')) return;
      const hour = new Date().toISOString().slice(0, 13) + ':00Z';
      add.run(hour, page, refOf(req.headers.referer, ownHost), kindOf(req.headers['user-agent']));
    },
  };
}
