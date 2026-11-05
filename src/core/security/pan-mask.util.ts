/** Mask Indian PAN for API responses — never echo the full password material. */
export function maskPan(pan: string | null | undefined): string {
  const raw = (pan || '').trim().toUpperCase();
  if (raw.length < 4) return '****';
  return `${'*'.repeat(Math.max(0, raw.length - 4))}${raw.slice(-4)}`;
}
