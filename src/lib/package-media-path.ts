/** Only immutable UUIDv4 asset references are accepted; never an arbitrary local URL. */
export const PACKAGE_MEDIA_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function packageMediaId(value: string): string | null {
  const prefix = "/api/public/package-media/";
  if (!value.startsWith(prefix)) return null;
  const id = value.slice(prefix.length);
  return PACKAGE_MEDIA_ID.test(id) ? id : null;
}
export function packageMediaUrl(id: string) { return `/api/public/package-media/${id}`; }
