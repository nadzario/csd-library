import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchReleaseAsset } from '../src/lib/release-download.js';
afterEach(() => vi.unstubAllGlobals());
const asset = 'https://github.com/nadzario/csd-early/releases/download/library/file.pdf';
describe('release proxy destinations', () => {
  it('rejects local addresses and non-release URLs without making a request', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    for (const url of ['http://127.0.0.1/', 'https://github.com/login', 'file:///etc/passwd', 'https://github.com@127.0.0.1/releases/download/a/b']) {
      await expect(fetchReleaseAsset(url)).rejects.toThrow();
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects a redirect to an internal service', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } }));
    vi.stubGlobal('fetch', fetcher);
    await expect(fetchReleaseAsset(asset)).rejects.toThrow('Untrusted');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('allows the GitHub asset CDN', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/asset' } })).mockResolvedValueOnce(new Response('PDF'));
    vi.stubGlobal('fetch', fetcher);
    expect(await (await fetchReleaseAsset(asset)).text()).toBe('PDF');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
