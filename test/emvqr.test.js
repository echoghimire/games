import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildTlv, crc16, describeQr, hasValidCrc, parseTlv, toDynamicQr, withCrc } from '../shared/emvqr.js'

// A made-up static merchant QR in the Fonepay/NepalQR shape.
const STATIC = withCrc(
  buildTlv([
    { id: '00', value: '01' },
    { id: '01', value: '11' },
    { id: '26', value: buildTlv([{ id: '00', value: 'fonepay.com' }, { id: '01', value: '2222222222' }]) },
    { id: '52', value: '5734' },
    { id: '53', value: '524' },
    { id: '58', value: 'NP' },
    { id: '59', value: 'KTM TRONIX' },
    { id: '60', value: 'KATHMANDU' },
    { id: '62', value: buildTlv([{ id: '07', value: 'T01' }]) },
  ]),
)

test('CRC-16/CCITT-FALSE check value', () => {
  assert.equal(crc16('123456789'), '29B1')
})

test('the static fixture is a valid QR', () => {
  assert.ok(hasValidCrc(STATIC))
  assert.equal(describeQr(STATIC).merchantName, 'KTM TRONIX')
})

test('dynamic QR adds amount, reference and a fresh CRC, keeping merchant data', () => {
  const dyn = toDynamicQr(STATIC, { amount: 499, reference: 'TRX-AB12CD', purpose: 'Arena pass' })
  assert.ok(hasValidCrc(dyn))
  const f = Object.fromEntries(parseTlv(dyn).map(x => [x.id, x.value]))
  assert.equal(parseTlv(dyn)[0].id, '00')
  assert.equal(parseTlv(dyn).at(-1).id, '63')
  assert.equal(f['01'], '12')
  assert.equal(f['54'], '499.00')
  assert.equal(f['26'], parseTlv(STATIC).find(x => x.id === '26').value)
  const add = Object.fromEntries(parseTlv(f['62']).map(x => [x.id, x.value]))
  assert.deepEqual(add, { '01': 'TRX-AB12CD', '05': 'TRX-AB12CD', '07': 'T01', '08': 'Arena pass' })
})

test('rejects junk and bad input', () => {
  assert.throws(() => toDynamicQr('hello', { amount: 1, reference: 'X' }))
  assert.throws(() => toDynamicQr(STATIC, { amount: 0, reference: 'X' }))
  assert.throws(() => toDynamicQr(STATIC, { amount: 10, reference: 'bad ref!' }))
})
