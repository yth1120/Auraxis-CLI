export function displayWidth(value: string): number {
  let width = 0;
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe4f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x20000 && code <= 0x2ffff)
    ) {
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}

export function truncateByWidth(value: string, maxWidth: number): string {
  if (maxWidth <= 0) return '';
  let width = 0;
  let result = '';
  for (const char of value) {
    const charWidth = displayWidth(char);
    if (width + charWidth > maxWidth) {
      if (width < maxWidth) result += '…';
      break;
    }
    result += char;
    width += charWidth;
  }
  return result;
}
