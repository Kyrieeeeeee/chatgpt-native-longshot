// Avoid Uint8Array.from(string, callback): it builds an intermediate iterable
// and calls JS for every byte. Works on the existing Chrome 118 baseline.
export function decodeBase64(encoded: string): Uint8Array<ArrayBuffer> {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
