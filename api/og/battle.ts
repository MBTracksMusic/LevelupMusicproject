import {
  buildBattleDescription,
  buildBattleShareTitle,
  escapeHtml,
  fetchBattleOgData,
  getBattleAppPath,
  getBattleSharePath,
  type BattleShareTarget,
} from '../_shared/battle-og.js';

interface ApiRequest {
  query?: Record<string, string | string[] | undefined>;
  headers?: Record<string, string | string[] | undefined>;
}

interface ApiResponse {
  setHeader: (name: string, value: string) => void;
  status: (code: number) => ApiResponse;
  send: (body: string) => void;
}

const OG_IMAGE_VERSION = '3';

function getTarget(value: string | null): BattleShareTarget {
  return value === 'feedback' ? 'feedback' : 'battle';
}

function isTruthyFlag(value: string | null) {
  return value === '1' || value === 'true';
}

function queryString(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function headerString(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function getOrigin(req: ApiRequest) {
  const host = headerString(req.headers?.['x-forwarded-host']) ??
    headerString(req.headers?.host) ??
    'www.beatelion.com';
  const fallbackProtocol = host.startsWith('localhost') || host.startsWith('127.0.0.1')
    ? 'http'
    : 'https';
  const protocol = headerString(req.headers?.['x-forwarded-proto']) ?? fallbackProtocol;
  return `${protocol}://${host}`;
}

function buildUrl(
  origin: string,
  path: string,
  ref: string | null,
  previewVersion: string | null = null,
  extraParams: Record<string, string | null> = {},
) {
  const url = new URL(path, origin);
  if (ref) url.searchParams.set('ref', ref);
  if (previewVersion) url.searchParams.set('v', previewVersion);
  Object.entries(extraParams).forEach(([key, value]) => {
    if (value) url.searchParams.set(key, value);
  });
  return url.toString();
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  const slug = queryString(req.query?.slug)?.trim();

  if (!slug) {
    res.status(400).send('Missing battle slug');
    return;
  }

  const target = getTarget(queryString(req.query?.target));
  const ref = queryString(req.query?.ref)?.trim() || null;
  const previewVersion = queryString(req.query?.v)?.trim() || null;
  const isLoserCard = isTruthyFlag(queryString(req.query?.is_loser_card));
  const producerId = queryString(req.query?.producer_id)?.trim() || null;
  const origin = getOrigin(req);
  const loserCardParams = isLoserCard
    ? { is_loser_card: 'true', producer_id: producerId }
    : {};
  const battle = await fetchBattleOgData(slug, { isLoserCard }).catch((error) => {
    console.error('[battle-og] unable to fetch battle data', error);
    return null;
  });

  const title = buildBattleShareTitle(battle, target, isLoserCard);
  const description = buildBattleDescription(battle, target, isLoserCard);
  const appUrl = buildUrl(origin, getBattleAppPath(slug, target), ref);
  const shareUrl = buildUrl(origin, getBattleSharePath(slug, target), ref, previewVersion, loserCardParams);
  const imageUrl = new URL('/api/og/battle-image', origin);
  imageUrl.searchParams.set('slug', slug);
  imageUrl.searchParams.set('target', target);
  imageUrl.searchParams.set('v', previewVersion ?? OG_IMAGE_VERSION);
  if (isLoserCard) {
    imageUrl.searchParams.set('is_loser_card', 'true');
    if (producerId) imageUrl.searchParams.set('producer_id', producerId);
  }

  const html = `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}">
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="Beatelion">
    <meta property="og:url" content="${escapeHtml(shareUrl)}">
    <meta property="og:title" content="${escapeHtml(title)}">
    <meta property="og:description" content="${escapeHtml(description)}">
    <meta property="og:image" content="${escapeHtml(imageUrl.toString())}">
    <meta property="og:image:type" content="image/png">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta property="og:image:alt" content="${escapeHtml(title)}">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${escapeHtml(title)}">
    <meta name="twitter:description" content="${escapeHtml(description)}">
    <meta name="twitter:image" content="${escapeHtml(imageUrl.toString())}">
  </head>
  <body style="background:#09090b;color:#f4f4f5;font-family:Inter,system-ui,sans-serif">
    <main style="min-height:100vh;display:grid;place-items:center;text-align:center;padding:24px">
      <div>
        <h1>${escapeHtml(title)}</h1>
        <p>${escapeHtml(description)}</p>
        <p><a style="color:#ff6b2b" href="${escapeHtml(appUrl)}">Ouvrir la battle</a></p>
      </div>
    </main>
    <script>window.location.replace(${JSON.stringify(appUrl)});</script>
  </body>
</html>`;

  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.setHeader('cache-control', 'public, s-maxage=300, stale-while-revalidate=3600');
  res.status(200).send(html);
}
