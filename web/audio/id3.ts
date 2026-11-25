/**
 * Titre en cours lu dans une étiquette ID3 qu'un flux HLS porte dans ses morceaux (hls.js la
 * remonte par `FRAG_PARSING_METADATA`) : `TIT2` (titre), `TPE1` (artiste), ou `TXXX`
 * « StreamTitle » à la manière des métadonnées ICY.
 */

function syncsafe(bytes: Uint8Array, at: number): number {
  return (
    ((bytes[at]! & 0x7f) << 21) |
    ((bytes[at + 1]! & 0x7f) << 14) |
    ((bytes[at + 2]! & 0x7f) << 7) |
    (bytes[at + 3]! & 0x7f)
  );
}

/** Texte d'un cadre ID3 selon son octet d'encodage, jusqu'au premier zéro. */
function decodeText(encoding: number, bytes: Uint8Array): string {
  // UTF-16 avec marque d'ordre : FE FF annonce du gros-boutiste.
  const bigEndian = encoding === 2 || (encoding === 1 && bytes[0] === 0xfe && bytes[1] === 0xff);
  const label =
    encoding === 1 || encoding === 2
      ? bigEndian
        ? 'utf-16be'
        : 'utf-16le'
      : encoding === 3
        ? 'utf-8'
        : 'latin1';
  return new TextDecoder(label).decode(bytes).split('\u0000')[0]!.trim();
}

/** Les cadres texte d'une étiquette ID3v2.3 ou 2.4 ; `TXXX` est rangé sous sa description. */
export function id3Frames(bytes: Uint8Array): Map<string, string> {
  const frames = new Map<string, string>();
  if (bytes.length < 10 || bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33)
    return frames;
  const version = bytes[3]!;
  const end = Math.min(bytes.length, 10 + syncsafe(bytes, 6));
  let at = 10;
  if (bytes[5]! & 0x40) at += version === 4 ? syncsafe(bytes, at) : 4 + readUint32(bytes, at);
  while (at + 10 <= end) {
    const id = String.fromCharCode(...bytes.subarray(at, at + 4));
    if (!/^[A-Z0-9]{4}$/u.test(id)) break;
    const size = version === 4 ? syncsafe(bytes, at + 4) : readUint32(bytes, at + 4);
    const body = bytes.subarray(at + 10, Math.min(end, at + 10 + size));
    at += 10 + size;
    if (!body.length || !id.startsWith('T')) continue;
    const encoding = body[0]!;
    if (id === 'TXXX') {
      const rest = body.subarray(1);
      const wide = encoding === 1 || encoding === 2;
      let split = -1;
      for (let index = 0; index < rest.length; index += wide ? 2 : 1)
        if (rest[index] === 0 && (!wide || rest[index + 1] === 0)) {
          split = index;
          break;
        }
      if (split < 0) continue;
      const description = decodeText(encoding, rest.subarray(0, split));
      frames.set(
        `TXXX:${description}`,
        decodeText(encoding, rest.subarray(split + (wide ? 2 : 1))),
      );
      continue;
    }
    frames.set(id, decodeText(encoding, body.subarray(1)));
  }
  return frames;
}

function readUint32(bytes: Uint8Array, at: number): number {
  return (
    ((bytes[at]! << 24) | (bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!) >>> 0
  );
}

/** « Artiste – Titre », le titre seul, ou null s'il n'y a rien à afficher. */
export function id3Title(bytes: Uint8Array): string | null {
  const frames = id3Frames(bytes);
  const title = frames.get('TIT2');
  const artist = frames.get('TPE1');
  const text =
    title && artist ? `${artist} – ${title}` : (title ?? frames.get('TXXX:StreamTitle') ?? null);
  return text ? text.slice(0, 120) : null;
}
