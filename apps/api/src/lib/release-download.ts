const assetHosts = new Set([
  'github.com', 'release-assets.githubusercontent.com',
  'objects.githubusercontent.com', 'github-releases.githubusercontent.com',
]);

export async function fetchReleaseAsset(value: string): Promise<Response> {
  let url = new URL(value);
  if (url.hostname !== 'github.com' || !/^\/[^/]+\/[^/]+\/releases\/download\/[^/]+\/.+/.test(url.pathname)) {
    throw new Error('Only GitHub release asset URLs can be proxied');
  }
  const signal = AbortSignal.timeout(300_000);
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    if (url.protocol !== 'https:' || url.port || url.username || url.password || !assetHosts.has(url.hostname)) {
      throw new Error('Untrusted release asset destination');
    }
    const response = await fetch(url, { redirect: 'manual', signal });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    await response.body?.cancel();
    if (!location) throw new Error('Release asset redirect has no destination');
    url = new URL(location, url);
  }
  throw new Error('Too many release asset redirects');
}
