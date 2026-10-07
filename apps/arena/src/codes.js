// No 0/O/1/I/L so codes are easy to read out loud.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const ROOM_CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/

export function newRoomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  return [...bytes].map(b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('')
}
