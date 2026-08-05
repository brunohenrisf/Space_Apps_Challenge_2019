/**
 * Detecção de tipo por assinatura de bytes.
 *
 * O `Content-Type` e a extensão vêm do cliente e não são confiáveis: qualquer
 * pessoa com a URL do QR Code pode forjá-los. O que é gravado em disco usa
 * sempre a extensão derivada daqui, nunca o nome enviado.
 */

const HEIF_BRANDS = new Set([
  'heic',
  'heix',
  'hevc',
  'hevx',
  'heim',
  'heis',
  'hevm',
  'hevs',
  'mif1',
  'msf1',
]);

/** @returns {{ext: string, mime: string} | null} */
export function detectImageType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 16) return null;

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { ext: '.jpg', mime: 'image/jpeg' };
  }

  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { ext: '.png', mime: 'image/png' };
  }

  const first6 = buffer.subarray(0, 6).toString('latin1');
  if (first6 === 'GIF87a' || first6 === 'GIF89a') {
    return { ext: '.gif', mime: 'image/gif' };
  }

  if (
    buffer.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buffer.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return { ext: '.webp', mime: 'image/webp' };
  }

  // Família ISO-BMFF: fotos do iPhone (HEIC) e AVIF.
  if (buffer.subarray(4, 8).toString('latin1') === 'ftyp') {
    const brand = buffer.subarray(8, 12).toString('latin1');
    if (brand === 'avif' || brand === 'avis') return { ext: '.avif', mime: 'image/avif' };
    if (HEIF_BRANDS.has(brand)) return { ext: '.heic', mime: 'image/heic' };
  }

  return null;
}
