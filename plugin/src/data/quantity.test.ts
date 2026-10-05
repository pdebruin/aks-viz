import { describe, expect, it } from 'vitest';
import { cpuToMillicores, memoryToBytes, parseQuantity } from './quantity';

describe('parseQuantity', () => {
  it.each([
    ['1', 1],
    ['0.5', 0.5],
    ['.5', 0.5],
    ['250m', 0.25],
    ['100u', 1e-4],
    ['5n', 5e-9],
    ['1k', 1000],
    ['2M', 2e6],
    ['3G', 3e9],
    ['1T', 1e12],
    ['1E', 1e18],
    ['1Ki', 1024],
    ['128Mi', 128 * 2 ** 20],
    ['1.5Gi', 1.5 * 2 ** 30],
    ['1Ti', 2 ** 40],
    ['1e3', 1000],
    ['1E3', 1000],
    ['12e-3', 0.012],
    ['+2', 2],
  ])('%s -> %d', (input, expected) => {
    expect(parseQuantity(input)).toBeCloseTo(expected, 12);
  });

  it.each(['', 'abc', '1Xi', '1 Mi', 'Mi', '1e'])('rejects %j', input => {
    expect(parseQuantity(input)).toBeNull();
  });

  it('handles undefined', () => {
    expect(parseQuantity(undefined)).toBeNull();
  });
});

describe('cpu and memory conversion', () => {
  it('cpu to millicores', () => {
    expect(cpuToMillicores('3860m')).toBe(3860);
    expect(cpuToMillicores('2')).toBe(2000);
    expect(cpuToMillicores('0.1')).toBe(100);
    expect(cpuToMillicores(undefined)).toBe(0);
  });
  it('memory to bytes', () => {
    expect(memoryToBytes('5935076Ki')).toBe(5935076 * 1024);
    expect(memoryToBytes('1G')).toBe(1e9);
    expect(memoryToBytes('129e6')).toBe(129_000_000);
    expect(memoryToBytes(undefined)).toBe(0);
  });
});
