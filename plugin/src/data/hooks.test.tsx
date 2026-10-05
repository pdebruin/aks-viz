import { act, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClusterResourcesProvider, useClusterResources } from './hooks';
import { LIST_RETRY_MS } from './listState';

type Response = { items: Array<{ jsonData: unknown }> | null; errors: unknown[] | null };

const fake = vi.hoisted(() => ({
  responses: {} as Record<string, Response>,
  mounts: {} as Record<string, number>,
  allowed: [] as string[],
}));

vi.mock('@kinvolk/headlamp-plugin/lib', async () => {
  const { useEffect } = await vi.importActual<typeof React>('react');
  const fakeClass = (name: string, isNamespaced: boolean) => ({
    isNamespaced,
    useList() {
      useEffect(() => {
        fake.mounts[name] = (fake.mounts[name] ?? 0) + 1;
      }, []);
      return fake.responses[name];
    },
  });
  return {
    K8s: {
      ResourceClasses: {
        Node: fakeClass('nodes', false),
        Pod: fakeClass('pods', true),
        DaemonSet: fakeClass('daemonsets', true),
      },
      cluster: { getAllowedNamespaces: () => fake.allowed },
    },
  };
});

const { responses, mounts } = fake;

function Probe() {
  const r = useClusterResources();
  return (
    <p data-testid="probe">
      {`loading=${r.loading} nodes=${r.lists.nodes.status} pods=${r.lists.pods.status}:${
        r.pods?.length ?? 'null'
      } ds=${r.lists.daemonsets.status} retrying=${!!r.lists.pods.retrying}`}
    </p>
  );
}

const ok = (n: number): Response => ({
  items: Array.from({ length: n }, (_, i) => ({ jsonData: { metadata: { name: `x${i}` } } })),
  errors: null,
});
const forbidden: Response = {
  items: [],
  errors: [{ status: 403, message: 'pods is forbidden' }],
};

describe('ClusterResourcesProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fake.allowed = [];
    for (const k of Object.keys(mounts)) delete mounts[k];
    responses.nodes = ok(2);
    responses.daemonsets = ok(1);
  });
  afterEach(() => vi.useRealTimers());

  it('keeps the other lists when pods are forbidden, retries pods only and recovers', () => {
    responses.pods = forbidden;
    render(
      <ClusterResourcesProvider>
        <Probe />
      </ClusterResourcesProvider>
    );
    expect(screen.getByTestId('probe').textContent).toBe(
      'loading=false nodes=ok pods=failed:null ds=ok retrying=false'
    );

    // Still forbidden on retry: stays failed, and only the pod list was requested again.
    act(() => vi.advanceTimersByTime(LIST_RETRY_MS));
    expect(mounts).toEqual({ nodes: 1, pods: 2, daemonsets: 1 });
    expect(screen.getByTestId('probe').textContent).toContain('pods=failed:null');

    // Access granted: the next retry brings the pods in.
    responses.pods = ok(3);
    act(() => vi.advanceTimersByTime(LIST_RETRY_MS));
    expect(screen.getByTestId('probe').textContent).toBe(
      'loading=false nodes=ok pods=ok:3 ds=ok retrying=false'
    );

    // No more retries once every list works.
    act(() => vi.advanceTimersByTime(LIST_RETRY_MS * 3));
    expect(mounts).toEqual({ nodes: 1, pods: 3, daemonsets: 1 });
  });

  it('keeps showing the failure, marked as retrying, while a retry is pending', () => {
    responses.pods = forbidden;
    render(
      <ClusterResourcesProvider>
        <Probe />
      </ClusterResourcesProvider>
    );
    responses.pods = { items: null, errors: null };
    act(() => vi.advanceTimersByTime(LIST_RETRY_MS));
    expect(screen.getByTestId('probe').textContent).toBe(
      'loading=false nodes=ok pods=failed:null ds=ok retrying=true'
    );
  });

  it('reports a partial pod list when some allowed namespaces are forbidden', () => {
    fake.allowed = ['kube-system', 'shop'];
    responses.pods = {
      items: ok(1).items,
      errors: [{ status: 403, namespace: 'kube-system', message: 'forbidden' }],
    };
    render(
      <ClusterResourcesProvider>
        <Probe />
      </ClusterResourcesProvider>
    );
    expect(screen.getByTestId('probe').textContent).toContain('pods=partial:1');
  });

  it('throws a clear error when used outside the provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/ClusterResourcesProvider/);
  });
});
