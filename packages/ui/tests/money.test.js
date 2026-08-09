// The money helpers are pure and have no React in them, so they are tested the
// same way the server is: `node --test`, no bundler, no simulator.
//
// This file exists because a float bug in money is *silent*. Nothing throws; a
// bill is just wrong by a paisa and stays wrong. The backend moved 28 columns to
// `Decimal` to prevent exactly that, and these assertions are the client-side
// half of the same promise.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatINR,
  formatAmount,
  formatCompact,
  addMoney,
  subMoney,
  mulMoney,
  compareMoney,
  isZeroMoney,
  toNumberForDisplayOnly
} from '../src/money.js';

test('formats a fixed-2 string with Indian grouping', () => {
  assert.equal(formatINR('294.00'), '₹294.00');
  assert.equal(formatINR('1234.50'), '₹1,234.50');
  // Lakhs group in 2s, not 3s — "12,34,567.89", never "1,234,567.89".
  assert.equal(formatINR('1234567.89'), '₹12,34,567.89');
  assert.equal(formatINR('100000.00'), '₹1,00,000.00');
});

test('tolerates the shapes an API can hand back', () => {
  assert.equal(formatINR('12'), '₹12.00');
  assert.equal(formatINR('12.5'), '₹12.50');
  assert.equal(formatINR(null), '₹0.00');
  assert.equal(formatINR('-45.25'), '-₹45.25');
});

test('formatCompact drops paise for stat tiles', () => {
  assert.equal(formatCompact('12300.00'), '₹12,300');
});

test('adds money exactly — the sum a float would get wrong', () => {
  // 0.1 + 0.2 === 0.30000000000000004 as floats. Not here.
  assert.equal(addMoney('0.10', '0.20'), '0.30');
  assert.equal(addMoney('0.01', '0.02', '0.03'), '0.06');

  // A hundred ₹0.07 lines: the classic accumulating-drift case.
  const total = Array.from({ length: 100 }).reduce((sum) => addMoney(sum, '0.07'), '0.00');
  assert.equal(total, '7.00');
});

test('adds beyond the safe-integer range without losing paise', () => {
  // Larger than Number.MAX_SAFE_INTEGER in paise — the reason the arithmetic is
  // BigInt rather than integer-paise-as-Number.
  assert.equal(addMoney('99999999999999.99', '0.01'), '100000000000000.00');
});

test('subtracts and compares exactly', () => {
  assert.equal(subMoney('100.00', '33.33'), '66.67');
  assert.equal(subMoney('10.00', '10.01'), '-0.01');
  assert.equal(compareMoney('10.00', '9.99'), 1);
  assert.equal(compareMoney('10.00', '10.00'), 0);
  assert.equal(compareMoney('9.99', '10.00'), -1);
  assert.ok(isZeroMoney('0.00'));
  assert.ok(!isZeroMoney('0.01'));
});

test('multiplies by a whole count — a line total, exactly', () => {
  assert.equal(mulMoney('38.25', 3), '114.75');
  assert.equal(mulMoney('0.07', 100), '7.00');
  assert.equal(mulMoney('294.00', 0), '0.00');
});

test('refuses a fractional multiplier', () => {
  // Percentages and commissions are the server's arithmetic. Recomputing them
  // here would produce a second answer that disagrees with the ledger.
  assert.throws(() => mulMoney('100.00', 0.15));
  assert.throws(() => mulMoney('100.00', -1));
});

test('formatAmount handles B2B floats as well as B2C strings', () => {
  // B2B money is deliberately still `Float` — 7 dashboards read those columns
  // and a server test enforces it.
  assert.equal(formatAmount(7940), '₹7,940.00');
  assert.equal(formatAmount(38.25), '₹38.25');
  assert.equal(formatAmount('38.25'), '₹38.25');
});

test('toNumberForDisplayOnly is exact enough to sort by', () => {
  assert.equal(toNumberForDisplayOnly('1234.56'), 1234.56);
  assert.equal(toNumberForDisplayOnly('-0.01'), -0.01);
});
