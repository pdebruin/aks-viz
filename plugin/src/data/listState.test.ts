import { ApiError } from '@kinvolk/headlamp-plugin/lib/lib/k8s/api/v2/ApiError';
import { describe, expect, it } from 'vitest';
import { failedNamespaces, mergeListUpdate, toListFailure, toListResult } from './listState';

const forbidden = (namespace?: string) =>
  Object.assign(new ApiError('pods is forbidden', { status: 403 }), { namespace });

describe('toListResult', () => {
  it('is loading until items or an error arrive', () => {
    expect(toListResult(null, null, [], true).state.status).toBe('loading');
  });

  it('is ok with items and no errors', () => {
    const r = toListResult([1, 2], null, [], true);
    expect(r).toEqual({ items: [1, 2], state: { status: 'ok', failures: [], scopedTo: [] } });
  });

  it('treats a cluster-wide 403 as failed even though useList returns an empty list', () => {
    const r = toListResult([], [forbidden()], [], true);
    expect(r.items).toBeNull();
    expect(r.state.status).toBe('failed');
    expect(r.state.failures).toEqual([
      { status: 403, namespace: undefined, message: 'pods is forbidden' },
    ]);
  });

  it('treats a non-403 error the same way, keeping its status', () => {
    const r = toListResult([], [new ApiError('boom', { status: 500 })], [], false);
    expect(r.state.status).toBe('failed');
    expect(r.state.failures[0].status).toBe(500);
  });

  it('is partial when some allowed namespaces fail and keeps the rest', () => {
    const r = toListResult(['a'], [forbidden('kube-system')], ['shop', 'kube-system'], true);
    expect(r.items).toEqual(['a']);
    expect(r.state.status).toBe('partial');
    expect(r.state.scopedTo).toEqual(['kube-system', 'shop']);
    expect(failedNamespaces(r.state)).toEqual(['kube-system']);
  });

  it('is failed when every allowed namespace fails', () => {
    const r = toListResult([], [forbidden('a'), forbidden('b')], ['a', 'b'], true);
    expect(r.state.status).toBe('failed');
  });

  it('ignores allowed namespaces for cluster-scoped resources', () => {
    expect(toListResult([1], null, ['a'], false).state.scopedTo).toEqual([]);
  });
});

describe('toListFailure', () => {
  it('accepts strings and plain errors without a status', () => {
    expect(toListFailure('x')).toEqual({ message: 'x' });
    expect(toListFailure(new Error('net'))).toEqual({
      status: undefined,
      namespace: undefined,
      message: 'net',
    });
  });
});

describe('mergeListUpdate', () => {
  const failed = toListResult([], [forbidden()], [], true);
  const loading = toListResult(null, null, [], true);

  it('keeps the last failure while the list is retried', () => {
    const r = mergeListUpdate(failed, loading);
    expect(r.state.status).toBe('failed');
    expect(r.state.retrying).toBe(true);
  });

  it('recovers when the retry succeeds', () => {
    const r = mergeListUpdate(mergeListUpdate(failed, loading), toListResult([1], null, [], true));
    expect(r.state.status).toBe('ok');
    expect(r.items).toEqual([1]);
  });

  it('shows loading on first load', () => {
    expect(mergeListUpdate(loading, loading).state.status).toBe('loading');
  });
});
