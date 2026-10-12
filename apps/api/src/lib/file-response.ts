// Upload metadata is untrusted, including for files already in the catalog.
const passiveTypes = new Map([
  ['pdf', 'application/pdf'], ['jpg', 'image/jpeg'], ['jpeg', 'image/jpeg'],
  ['png', 'image/png'], ['gif', 'image/gif'], ['webp', 'image/webp'],
  ['bmp', 'image/bmp'], ['txt', 'text/plain'], ['md', 'text/plain'],
  ['csv', 'text/plain'], ['json', 'text/plain'], ['xml', 'text/plain'],
  ['html', 'text/plain'], ['htm', 'text/plain'], ['svg', 'text/plain'],
]);

export function fileResponse(fileName: string) {
  const extension = fileName.split('.').pop()?.toLowerCase() || '';
  const type = passiveTypes.get(extension) || 'application/octet-stream';
  return {
    type,
    disposition: `${passiveTypes.has(extension) ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
  };
}
