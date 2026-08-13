import crypto from 'node:crypto'

function base32Decode(b32: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const c of b32.replace(/=+$/, '').toUpperCase()) {
    const val = alphabet.indexOf(c)
    if (val === -1) continue
    bits += val.toString(2).padStart(5, '0')
  }
  const bytes: number[] = []
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.substr(i, 8), 2))
  }
  return Buffer.from(bytes)
}

/** Genere le code TOTP courant (RFC 6238, HMAC-SHA1, 30s, 6 chiffres). */
export function computeTotp(secretBase32: string, timeStep = 30, digits = 6): string {
  const key = base32Decode(secretBase32)
  const counter = Math.floor(Date.now() / 1000 / timeStep)
  const buf = Buffer.alloc(8)
  buf.writeUInt32BE(0, 0)
  buf.writeUInt32BE(counter, 4)
  const hmac = crypto.createHmac('sha1', key).update(buf).digest()
  const offset = hmac[hmac.length - 1] & 0xf
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  return (code % 10 ** digits).toString().padStart(digits, '0')
}
