import { describe, expect, it } from 'vitest';
import type { ListState } from '../data/listState';
import { describeFailures, describeListProblems, httpStatusText } from './listProblems';

const ok = (): ListState => ({ status: 'ok', failures: [], scopedTo: [] });

describe('httpStatusText', () => {
  it('names common statuses and falls back to the number', () => {
    expect(httpStatusText(403)).toBe('HTTP 403 Forbidden');
    expect(httpStatusText(418)).toBe('HTTP 418');
    expect(httpStatusText(undefined)).toBe('no HTTP status');
  });
});

describe('describeFailures', () => {
  it('groups namespaces per status', () => {
    expect(
      describeFailures([
        { status: 403, namespace: 'b', message: '' },
        { status: 403, namespace: 'a', message: '' },
        { status: 500, namespace: 'c', message: '' },
      ])
    ).toBe('HTTP 403 Forbidden in a, b; HTTP 500 Internal Server Error in c');
  });
});

describe('describeListProblems', () => {
  it('is empty when every list is complete', () => {
    expect(describeListProblems({ nodes: ok(), pods: ok(), daemonsets: ok() })).toEqual([]);
  });

  it('orders nodes first and makes them an error, other lists warnings', () => {
    const failed: ListState = {
      status: 'failed',
      failures: [{ status: 403, message: 'x' }],
      scopedTo: [],
    };
    const p = describeListProblems({ nodes: failed, pods: failed, daemonsets: ok() });
    expect(p.map(x => [x.key, x.severity])).toEqual([
      ['nodes', 'error'],
      ['pods', 'warning'],
    ]);
  });

  it('asks to sign in again on 401', () => {
    const p = describeListProblems({
      nodes: ok(),
      pods: { status: 'failed', failures: [{ status: 401, message: 'x' }], scopedTo: [] },
      daemonsets: ok(),
    });
    expect(p[0].fix).toBe('The cluster rejected your credentials. Sign in to the cluster again.');
  });

  it('notes allowed namespaces even without errors, mentioning kube-system when it is left out', () => {
    const p = describeListProblems({
      nodes: ok(),
      pods: { status: 'ok', failures: [], scopedTo: ['shop'] },
      daemonsets: ok(),
    });
    expect(p).toHaveLength(1);
    expect(p[0].severity).toBe('info');
    expect(p[0].title).toBe(
      "Only the allowed namespaces from this cluster's Headlamp settings are listed: shop."
    );
    expect(p[0].consequence).toBe(
      'Pods in other namespaces, including kube-system, are not counted, so pod counts and requests may be too low and headroom too high.'
    );
  });
});
