'use strict'

const cbor = require('../')
const test = require('ava')
const cases = require('./cases')
const NoFilter = require('nofilter')
const BigNum = require('bignumber.js')

function testAll(t, list) {
  t.plan(list.length)
  return Promise.all(list.map(c => {
    t.is(cbor.encode(c[0]).toString('hex'), cases.toString(c), c[1])
  }))
}

test('good', t => testAll(t, cases.good))
test('encode', t => testAll(t, cases.encodeGood))

test('undefined', t => {
  t.is(cbor.Encoder.encode(), null)
  t.is(cbor.encode(undefined, 2).toString('hex'), 'f702')
})

test('badFunc', t => {
  t.throws(() => cbor.encode(() => 'hi'))
  t.throws(() => cbor.encode(Symbol('foo')))
})

test('addSemanticType', t => {
  // before the tag, this is an innocuous object:
  // {"value": "foo"}
  const tc = new cases.TempClass('foo')
  delete (cases.TempClass.prototype.encodeCBOR)
  t.is(cbor.Encoder.encode(tc).toString('hex'), 'a16576616c756563666f6f')
  const gen = new cbor.Encoder({
    genTypes: [cases.TempClass, cases.TempClass.toCBOR]
  })
  gen.write(tc)
  t.is(gen.read().toString('hex'), 'd9fffe63666f6f')

  function hexPackBuffer(gen, obj, bufs) {
    gen.write('0x' + obj.toString('hex'))
  // intentionally don't return
  }

  // replace Buffer serializer with hex strings
  gen.addSemanticType(Buffer, hexPackBuffer)
  gen.write(Buffer.from('010203', 'hex'))

  t.is(gen.read().toString('hex'), '683078303130323033')
})

test.cb('stream', t => {
  const bs = new NoFilter()
  const gen = new cbor.Encoder()
  gen.on('end', () => {
    t.deepEqual(bs.read(), Buffer.from([1, 2]))
    t.end()
  })
  gen.pipe(bs)
  gen.write(1)
  gen.end(2)
})

test.cb('streamNone', t => {
  const bs = new NoFilter()
  const gen = new cbor.Encoder()
  gen.on('end', () => {
    t.deepEqual(bs.read(), null)
    t.end()
  })
  gen.pipe(bs)
  gen.end()
})

test('pushFails', t => {
  cases.EncodeFailer.tryAll(t, [1, 2, 3])
  cases.EncodeFailer.tryAll(t, new Set([1, 2, 3]))
  cases.EncodeFailer.tryAll(t, new BigNum(0))
  cases.EncodeFailer.tryAll(t, new BigNum(1.1))
  cases.EncodeFailer.tryAll(t, new Map([[1, 2], ['a', null]]))
  cases.EncodeFailer.tryAll(t, {a: 1, b: null})
  cases.EncodeFailer.tryAll(t, undefined)
  cases.EncodeFailer.tryAll(t, cases.goodMap, true)
  cases.EncodeFailer.tryAll(t, {a: 1, b: null}, true)
})

test('_pushAny', t => {
  // Left this in for backward-compat.  This should be the only place it's
  // called.
  const enc = new cbor.Encoder()
  const bs = new NoFilter()
  enc.pipe(bs)
  enc._pushAny(0)
  t.deepEqual(bs.read(), Buffer.from('00', 'hex'))
})

test('canonical', t => {
  const enc = new cbor.Encoder({canonical: true})
  const bs = new NoFilter()
  enc.pipe(bs)
  enc.write(cases.goodMap)
  t.is(bs.read().toString('hex'),
    'ad0063626172613063666f6f616101616201626161026262620263616161036362626203806b656d7074792061727261798101656172726179a069656d707479206f626aa1613102636f626af6646e756c6c') // eslint-disable-line max-len
  enc.write({aa: 2, b:1})
  t.is(bs.read().toString('hex'),
    'a261620162616102')
})

test('canonical numbers', t => {
  const enc = new cbor.Encoder({canonical: true})
  const bs = new NoFilter()
  enc.pipe(bs)

  for (const numEnc of cases.canonNums) {
    enc.write(numEnc[0])
    t.is(bs.read().toString('hex'), numEnc[1])
  }
})

test('encodeCanonical', t => {
  t.deepEqual(cbor.encodeCanonical(-1.25), Buffer.from('f9bd00', 'hex'))
})

test('detect loops', t => {
  const enc = new cbor.Encoder({detectLoops: true})
  const bs = new NoFilter()
  enc.pipe(bs)

  const a = {c: false}
  const b = [a]
  enc.write(b)
  t.is(bs.read().toString('hex'), '81a16163f4')
  t.is(Object.getOwnPropertySymbols(a).length, 1)
  t.is(Object.getOwnPropertySymbols(b).length, 1)
  enc.removeLoopDetectors(b)
  t.is(Object.getOwnPropertySymbols(a).length, 0)
  t.is(Object.getOwnPropertySymbols(b).length, 0)
  enc.removeLoopDetectors(b)
  t.is(Object.getOwnPropertySymbols(a).length, 0)
  t.is(Object.getOwnPropertySymbols(b).length, 0)
  a.a = a
  t.throws(() => enc.write(b))
})

test('detect loops, own symbol', t => {
  const s = Symbol('MINE')
  const enc = new cbor.Encoder({detectLoops: s})
  const bs = new NoFilter()
  enc.pipe(bs)

  const a = {c: new Date()}
  enc.write(a)
  const a_syms = Object.getOwnPropertySymbols(a)
  const date_syms = Object.getOwnPropertySymbols(a.c)
  t.is(a_syms.length, 1)
  t.is(date_syms.length, 1)
  t.is(a[a_syms[0]], s)
  t.is(a.c[date_syms[0]], s)
})

test('date types', t => {
  const d = new Date('2018-06-05T14:36:20Z')

  t.is(
    cbor.encodeOne(d, {dateType: 'blorfff'}).toString('hex'),
    'c11a5b169fe4')

  t.is(
    cbor.encodeOne(d, {dateType: 'int'}).toString('hex'),
    'c11a5b169fe4')

  t.is(
    cbor.encodeOne(d, {dateType: 'float'}).toString('hex'),
    'c1fb41d6c5a7f9000000')

  t.is(
    cbor.encodeOne(d, {dateType: 'string'}).toString('hex'),
    'c07818323031382d30362d30355431343a33363a32302e3030305a')
})

test('js BigInt', t => {
  if (!cbor.hasBigInt) {
    return t.pass('No BigInt')
  }
  return testAll(t, cases.bigInts(cases.good))
})