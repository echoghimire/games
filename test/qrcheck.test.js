import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildTlv, withCrc } from '../shared/emvqr.js'
import { checkQr } from '../apps/landing/src/fonepay.js'

const STATIC = withCrc(
  buildTlv([
    { id: '00', value: '01' },
    { id: '01', value: '11' },
    { id: '26', value: buildTlv([{ id: '00', value: 'fonepay.com' }, { id: '01', value: '2222222222' }]) },
    { id: '53', value: '524' },
    { id: '59', value: 'KTM TRONIX' },
    { id: '60', value: 'KATHMANDU' },
  ]),
)

test('an uploaded static QR is accepted (whitespace trimmed)', () => {
  const r = checkQr(`  ${STATIC}\n`)
  assert.equal(r.payload, STATIC)
  assert.equal(r.info.merchantName, 'KTM TRONIX')
})

test('uploaded QRs that are not merchant QRs, or misread, are refused', () => {
  assert.match(checkQr('https://example.com').error, /Not a Fonepay/)
  assert.match(checkQr('').error, /No QR/)
  const broken = STATIC.slice(0, -1) + (STATIC.endsWith('0') ? '1' : '0')
  assert.match(checkQr(broken).error, /checksum/)
  assert.match(checkQr(withCrc(buildTlv([{ id: '00', value: '01' }, { id: '59', value: 'X' }]))).error, /merchant account/)
})
