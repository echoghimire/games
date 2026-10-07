// EMVCo merchant-presented QR codes (the format behind Fonepay / NepalQR).
//
// A QR payload is a list of TLV fields: 2-digit ID, 2-digit length, value.
// Fields 26-51 hold the merchant account (Fonepay's data), 53 the currency
// (524 = NPR), 54 the amount, 62 "additional data" (bill number, reference),
// and 63 a CRC-16/CCITT-FALSE checksum of everything before its value.
//
// toDynamicQr() takes the decoded text of the shop's static QR and returns a
// payload for one payment: point of initiation "12" (dynamic), the amount,
// and our reference in field 62 so the payment shows up with it.

export function parseTlv(payload) {
  const fields = []
  let i = 0
  while (i < payload.length) {
    const id = payload.slice(i, i + 2)
    const len = Number(payload.slice(i + 2, i + 4))
    if (!/^\d\d$/.test(id) || !Number.isInteger(len) || i + 4 + len > payload.length) {
      throw new Error(`Malformed QR data at position ${i}`)
    }
    fields.push({ id, value: payload.slice(i + 4, i + 4 + len) })
    i += 4 + len
  }
  return fields
}

export function buildTlv(fields) {
  return fields
    .map(({ id, value }) => {
      if (value.length > 99) throw new Error(`QR field ${id} is too long`)
      return id + String(value.length).padStart(2, '0') + value
    })
    .join('')
}

// CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) over the UTF-8 bytes.
export function crc16(text) {
  let crc = 0xffff
  for (const byte of new TextEncoder().encode(text)) {
    crc ^= byte << 8
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

export function withCrc(payloadWithoutCrc) {
  const body = payloadWithoutCrc + '6304'
  return body + crc16(body)
}

// True if the payload ends with a correct CRC field.
export function hasValidCrc(payload) {
  const i = payload.lastIndexOf('6304')
  return i === payload.length - 8 && crc16(payload.slice(0, i + 4)) === payload.slice(i + 4).toUpperCase()
}

/**
 * @param {string} staticPayload decoded text of the merchant's static QR
 * @param {object} opts
 * @param {string|number} opts.amount  e.g. 499 or "499.00" (in the QR's currency)
 * @param {string} opts.reference      our payment reference (max 25 chars)
 * @param {string} [opts.purpose]      shown by some banking apps (max 25 chars)
 */
export function toDynamicQr(staticPayload, { amount, reference, purpose }) {
  const clean = String(staticPayload).trim()
  const fields = parseTlv(clean)
  if (fields[0]?.id !== '00') throw new Error('Not an EMVCo QR (field 00 missing)')
  if (!fields.some(f => Number(f.id) >= 26 && Number(f.id) <= 51)) {
    throw new Error('QR has no merchant account information (fields 26-51)')
  }

  const amountText = Number(amount).toFixed(2)
  if (!(Number(amountText) > 0) || amountText.length > 13) throw new Error('Invalid amount')
  if (!/^[A-Za-z0-9-]{1,25}$/.test(reference)) throw new Error('Invalid reference')

  // Keep the merchant's own additional-data subfields except the ones we set.
  const old62 = fields.find(f => f.id === '62')
  const sub = old62 ? parseTlv(old62.value).filter(s => !['01', '05', '08'].includes(s.id)) : []
  sub.push({ id: '01', value: reference }, { id: '05', value: reference })
  if (purpose) sub.push({ id: '08', value: String(purpose).replace(/[^\w .-]/g, '').slice(0, 25) })
  sub.sort((a, b) => a.id.localeCompare(b.id))

  const out = fields.filter(f => !['01', '54', '62', '63'].includes(f.id))
  out.push({ id: '01', value: '12' }, { id: '54', value: amountText }, { id: '62', value: buildTlv(sub) })
  // 00 must stay first; the rest in ascending ID order (63 is appended last).
  out.sort((a, b) => (a.id === '00' ? -1 : b.id === '00' ? 1 : a.id.localeCompare(b.id)))
  return withCrc(buildTlv(out))
}

// Readable summary of a payload, for the admin page and error messages.
export function describeQr(payload) {
  const fields = parseTlv(payload)
  const get = id => fields.find(f => f.id === id)?.value
  return {
    merchantName: get('59') || '',
    merchantCity: get('60') || '',
    currency: get('53') || '',
    amount: get('54') || '',
    dynamic: get('01') === '12',
    crcOk: hasValidCrc(payload),
  }
}
