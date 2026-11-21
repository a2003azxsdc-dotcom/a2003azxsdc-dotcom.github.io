// Base64 helpers that work on large files in the browser and in Node.

export function bytesToBase64(bytes) {
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(b64) {
  const clean = String(b64).replace(/\s/g, '');
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function encodeUtf8Base64(text) {
  return bytesToBase64(new TextEncoder().encode(text));
}

export function decodeBase64Utf8(b64) {
  return new TextDecoder().decode(base64ToBytes(b64));
}
