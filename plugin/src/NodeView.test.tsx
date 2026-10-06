import { createMuiTheme } from '@kinvolk/headlamp-plugin/lib/lib/themes';
import store from '@kinvolk/headlamp-plugin/lib/redux/stores/store';
import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { Provider } from 'react-redux';
import { MemoryRouter, Route } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NodeView } from './NodeView';

type List = { items: Array<{ jsonData: unknown }> | null; errors: unknown[] | null };
const fake = vi.hoisted(() => ({
  lists: {} as Record<string, List>,
  calls: [] as Array<[string, unknown]>,
}));

vi.mock('@kinvolk/headlamp-plugin/lib', () => {
  const cls = (kind: string) => ({
    useList(opts: unknown) {
      fake.calls.push([kind, opts]);
      return fake.lists[kind];
    },
  });
  return {
    K8s: {
      useCluster: () => 'cluster-a',
      ResourceClasses: { Node: cls('nodes'), Pod: cls('pods') },
    },
  };
});

// jsdom has no ResizeObserver; Headlamp's PercentageBar (recharts) needs one.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const ok = (items: unknown[]): List => ({
  items: items.map(jsonData => ({ jsonData })),
  errors: null,
});
const labels = { 'karpenter.sh/nodepool': 'default', 'kubernetes.azure.com/mode': 'user' };
const node = (name: string) => ({
  metadata: { name, labels },
  status: {
    allocatable: { cpu: '4', memory: '8Gi' },
    conditions: [{ type: 'Ready', status: 'True' }],
  },
});
const pod = (
  name: string,
  namespace: string,
  nodeName: string,
  owner: string[],
  status: object
) => ({
  metadata: {
    name,
    namespace,
    uid: name,
    ownerReferences: [{ kind: owner[0], name: owner[1], controller: true }],
  },
  spec: {
    nodeName,
    containers: [{ name: 'c', resources: { requests: { cpu: '500m', memory: '1Gi' } } }],
  },
  status,
});
const ready = { phase: 'Running', conditions: [{ type: 'Ready', status: 'True' }] };

function renderView() {
  return render(
    <ThemeProvider theme={createMuiTheme({ name: 'light', base: 'light' })}>
      <Provider store={store}>
        <MemoryRouter initialEntries={['/c/cluster-a/aks-node-viz?pool=nap/default']}>
          <Route path="/c/:cluster/aks-node-viz">
            <NodeView />
          </Route>
        </MemoryRouter>
      </Provider>
    </ThemeProvider>
  );
}

beforeEach(() => {
  fake.calls.length = 0;
  fake.lists.nodes = ok([node('aks-default-a'), node('aks-default-b')]);
  fake.lists.pods = ok([
    pod('api-55d4c7b9f8-x2k9q', 'shop', 'aks-default-a', ['ReplicaSet', 'api-55d4c7b9f8'], {
      phase: 'Running',
      containerStatuses: [{ state: { waiting: { reason: 'CrashLoopBackOff' } } }],
    }),
    pod('kube-proxy-x', 'kube-system', 'aks-default-a', ['DaemonSet', 'kube-proxy'], ready),
  ]);
});

describe('NodeView', () => {
  it('lists the pool nodes with grouped pods and request bars, for the page cluster only', () => {
    renderView();
    expect(fake.calls.length).toBeGreaterThan(0);
    for (const [, opts] of fake.calls) expect(opts).toEqual({ cluster: 'cluster-a' });

    expect(screen.getByText('2 nodes, 2 pods: 1 user, 0 system, 1 node agent')).toBeTruthy();
    const a = screen.getByRole('region', { name: 'Node aks-default-a' });
    expect(within(a).getByText('User pods (1)')).toBeTruthy();
    expect(within(a).getByText('api')).toBeTruthy();
    expect(within(a).getByText('CrashLoopBackOff')).toBeTruthy();
    expect(within(a).getByText('1 / 4 cores requested, 3 unallocated')).toBeTruthy();
    // Agents start collapsed for a multi-node pool; the toggle opens every column.
    expect(within(a).queryByLabelText('kube-system/kube-proxy-x: Running')).toBeNull();
    fireEvent.click(within(a).getByRole('button', { name: 'Show agent list' }));
    expect(within(a).getByLabelText('kube-system/kube-proxy-x: Running')).toBeTruthy();
    const b = screen.getByRole('region', { name: 'Node aks-default-b' });
    expect(within(b).getByText('No user pods on this node.')).toBeTruthy();
  }, 60_000);

  it('says what failed and what RBAC is needed, and shows no request bars, when pods are forbidden', () => {
    fake.lists.pods = { items: null, errors: [{ status: 403, message: 'pods is forbidden' }] };
    renderView();
    expect(screen.getByText(/Pods could not be listed: HTTP 403/)).toBeTruthy();
    expect(screen.getByText(/Needs list and watch on pods in all namespaces/)).toBeTruthy();
    expect(screen.getByText('2 nodes, pods unknown')).toBeTruthy();
    expect(screen.getAllByText('requests unknown, 4 cores allocatable')).toHaveLength(2);
    expect(screen.queryByText(/requested/)).toBeNull();
  });
});
