import { createMuiTheme } from '@kinvolk/headlamp-plugin/lib/lib/themes';
import store from '@kinvolk/headlamp-plugin/lib/redux/stores/store';
import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { Provider } from 'react-redux';
import { MemoryRouter, Route } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ListedResource, ListState } from '../data/listState';
import { ctr, daemonSet, node, pod } from '../data/testFixtures';
import type { DaemonSetJson, NodeJson, PodJson } from '../data/types';
import { NodeView } from './NodeView';

const okList = (): ListState => ({ status: 'ok', failures: [], scopedTo: [] });

const fixture: {
  nodes: NodeJson[] | null;
  pods: PodJson[] | null;
  daemonSets: DaemonSetJson[] | null;
  lists: Record<ListedResource, ListState>;
} = {
  nodes: [],
  pods: [],
  daemonSets: [],
  lists: { nodes: okList(), pods: okList(), daemonsets: okList() },
};

vi.mock('../data/hooks', () => ({
  useClusterResources: () => ({ ...fixture, loading: false }),
}));

beforeEach(() => {
  fixture.lists = { nodes: okList(), pods: okList(), daemonsets: okList() };
});

// jsdom has no ResizeObserver; Headlamp's PercentageBar (recharts) needs one.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

function renderView() {
  const theme = createMuiTheme({ name: 'light', base: 'light' });
  return render(
    <ThemeProvider theme={theme}>
      <Provider store={store}>
        <MemoryRouter initialEntries={['/c/test/aks-node-viz?pool=nap/default']}>
          <Route path="/c/:cluster/aks-node-viz">
            <NodeView />
          </Route>
        </MemoryRouter>
      </Provider>
    </ThemeProvider>
  );
}

const napLabels = { 'karpenter.sh/nodepool': 'default', 'kubernetes.azure.com/mode': 'user' };
const ready = {
  phase: 'Running',
  conditions: [{ type: 'Ready', status: 'True' }],
} as PodJson['status'];

describe('NodeView render', () => {
  it('groups pods by kind, names agent gaps per node and scopes counts to the pool', () => {
    fixture.nodes = [node('aks-default-a', napLabels), node('aks-default-b', napLabels)];
    const crash = pod('api-55d4c7b9f8-x2k9q', 'shop', 'aks-default-a', {
      owner: { kind: 'ReplicaSet', name: 'api-55d4c7b9f8' },
    });
    crash.status = {
      phase: 'Running',
      conditions: [{ type: 'Ready', status: 'False' }],
      containerStatuses: [
        { name: 'main', restartCount: 4, state: { waiting: { reason: 'CrashLoopBackOff' } } },
      ],
    } as PodJson['status'];
    const proxy = pod('kube-proxy-x', 'kube-system', 'aks-default-a', {
      owner: { kind: 'DaemonSet', name: 'kube-proxy' },
      containers: [ctr('p', '100m', '64Mi')],
    });
    proxy.status = ready;
    fixture.pods = [crash, proxy];
    fixture.daemonSets = [daemonSet('kube-proxy', 'kube-system', {})];
    renderView();

    expect(screen.getByText('2 nodes, 2 pods: 1 user, 0 system, 1 node agent')).toBeTruthy();
    expect(screen.getByText('1 node agent, 0 on every node. 1 of 1 agent pod ready.')).toBeTruthy();
    expect(screen.getByText(/Missing on aks-default-b/)).toBeTruthy();

    const colA = screen.getByRole('region', { name: 'Node aks-default-a' });
    expect(within(colA).getByText('api')).toBeTruthy();
    expect(within(colA).getByText('CrashLoopBackOff')).toBeTruthy();
    expect(within(colA).getByText('User pods (1)')).toBeTruthy();
    expect(within(colA).getByText('Node agents (1)')).toBeTruthy();
    expect(within(colA).getByText('running')).toBeTruthy();
    expect(within(colA).queryByLabelText('kube-system/kube-proxy-x: Running')).toBeNull();
    expect(within(colA).getByText(/cores requested/)).toBeTruthy();

    const colB = screen.getByRole('region', { name: 'Node aks-default-b' });
    expect(within(colB).getByText('1 missing')).toBeTruthy();
    expect(within(colB).getByText('Missing: no pod on this node')).toBeTruthy();
    expect(within(colB).getByText('No user pods on this node.')).toBeTruthy();

    fireEvent.click(within(colA).getByRole('button', { name: 'Show agent list' }));
    expect(within(colA).getByLabelText('kube-system/kube-proxy-x: Running')).toBeTruthy();
    expect(within(colB).getByRole('button', { name: 'Hide agent list' })).toBeTruthy();
  }, 60_000);

  it('lists agents of a single node without a click and says "1 node"', () => {
    fixture.nodes = [node('aks-default-jw69b', napLabels)];
    const cilium = pod('cilium-xq7p2', 'kube-system', 'aks-default-jw69b', {
      owner: { kind: 'DaemonSet', name: 'cilium' },
    });
    cilium.status = ready;
    fixture.pods = [cilium];
    fixture.daemonSets = [daemonSet('cilium', 'kube-system', {})];
    renderView();

    expect(screen.getByText('1 node, 1 pod: 0 user, 0 system, 1 node agent')).toBeTruthy();
    expect(screen.getByText('1 node agent on every node. 1 of 1 agent pod ready.')).toBeTruthy();
    expect(screen.getByLabelText('kube-system/cilium-xq7p2: Running')).toBeTruthy();
  }, 60_000);
});

describe('NodeView with failed lists', () => {
  const forbidden = (namespace?: string): ListState['failures'][number] => ({
    status: 403,
    namespace,
    message: 'pods is forbidden: User "dev" cannot list resource "pods"',
  });

  function twoNodesWithAgent() {
    fixture.nodes = [node('aks-default-a', napLabels), node('aks-default-b', napLabels)];
    const proxy = pod('kube-proxy-x', 'kube-system', 'aks-default-a', {
      owner: { kind: 'DaemonSet', name: 'kube-proxy' },
    });
    proxy.status = ready;
    const web = pod('web-1', 'shop', 'aks-default-a');
    web.status = ready;
    fixture.pods = [proxy, web];
    fixture.daemonSets = [daemonSet('kube-proxy', 'kube-system', {})];
  }

  it('pods 403: shows nodes, says requests are unknown and names the missing permission', () => {
    twoNodesWithAgent();
    fixture.pods = null;
    fixture.lists.pods = { status: 'failed', failures: [forbidden()], scopedTo: [] };
    renderView();

    expect(screen.getByText('2 nodes, pods unknown')).toBeTruthy();
    expect(
      screen.getByText('Pods could not be listed: HTTP 403 Forbidden (cluster-wide).')
    ).toBeTruthy();
    expect(
      screen.getByText(/Pod requests, headroom and node agent coverage are unknown/)
    ).toBeTruthy();
    expect(
      screen.getByText('Needs list and watch on pods in all namespaces (a ClusterRole).')
    ).toBeTruthy();
    expect(screen.getByText('Node agents unknown: pods could not be listed.')).toBeTruthy();
    const colA = screen.getByRole('region', { name: 'Node aks-default-a' });
    expect(within(colA).getByText('Pods unknown: the pod list could not be loaded.')).toBeTruthy();
    expect(within(colA).getByText(/^requests unknown, [\d.]+ cores allocatable$/)).toBeTruthy();
    expect(within(colA).getByText(/^requests unknown, [\d.]+ GiB allocatable$/)).toBeTruthy();
    expect(within(colA).queryByText(/cores requested/)).toBeNull();
    expect(within(colA).queryByText('No user pods on this node.')).toBeNull();
    expect(screen.queryByText(/Missing/)).toBeNull();
  }, 60_000);

  it('nodes 403: explains that the view cannot be built instead of an empty page', () => {
    fixture.nodes = null;
    fixture.pods = [];
    fixture.lists.nodes = {
      status: 'failed',
      failures: [{ status: 403, message: 'nodes is forbidden' }],
      scopedTo: [],
    };
    renderView();

    expect(screen.getByText('Nodes unknown')).toBeTruthy();
    expect(
      screen.getByText('Nodes could not be listed: HTTP 403 Forbidden (cluster-wide).')
    ).toBeTruthy();
    expect(screen.getByText(/no node pools or nodes can be shown/)).toBeTruthy();
    expect(
      screen.getByText(
        'Needs list and watch on nodes. Nodes are cluster-scoped, so this takes a ClusterRole.'
      )
    ).toBeTruthy();
    expect(screen.getByText('Server message: nodes is forbidden')).toBeTruthy();
    expect(screen.queryByText(/No nodes found/)).toBeNull();
  }, 60_000);

  it('daemonsets 403: keeps pods and requests, reports no agent as missing', () => {
    twoNodesWithAgent();
    fixture.daemonSets = null;
    fixture.lists.daemonsets = {
      status: 'failed',
      failures: [{ status: 403, message: 'daemonsets.apps is forbidden' }],
      scopedTo: [],
    };
    renderView();

    expect(
      screen.getByText('DaemonSets could not be listed: HTTP 403 Forbidden (cluster-wide).')
    ).toBeTruthy();
    expect(
      screen.getByText(
        'Needs list and watch on daemonsets (API group apps) in all namespaces (a ClusterRole).'
      )
    ).toBeTruthy();
    expect(
      screen.getByText('Node agent coverage unknown: DaemonSets could not be listed.')
    ).toBeTruthy();
    expect(screen.queryByText(/Missing/)).toBeNull();
    const colA = screen.getByRole('region', { name: 'Node aks-default-a' });
    expect(within(colA).getByText('running, coverage unknown')).toBeTruthy();
    expect(within(colA).getByText(/cores requested/)).toBeTruthy();
    const colB = screen.getByRole('region', { name: 'Node aks-default-b' });
    expect(within(colB).getByText('coverage unknown')).toBeTruthy();
  }, 60_000);

  it('non-403 error: shows the status and server message without an RBAC hint', () => {
    twoNodesWithAgent();
    fixture.pods = null;
    fixture.lists.pods = {
      status: 'failed',
      failures: [{ status: 500, message: 'etcdserver: request timed out' }],
      scopedTo: [],
    };
    renderView();

    expect(
      screen.getByText('Pods could not be listed: HTTP 500 Internal Server Error (cluster-wide).')
    ).toBeTruthy();
    expect(screen.getByText('Server message: etcdserver: request timed out')).toBeTruthy();
    expect(screen.queryByText(/Needs list and watch/)).toBeNull();
    expect(screen.getByText(/Requested again every 30 seconds/)).toBeTruthy();
  }, 60_000);

  it('partial pods: says counts may be incomplete and drops agents of the denied namespace', () => {
    twoNodesWithAgent();
    fixture.pods = fixture.pods!.filter(p => p.metadata.namespace === 'shop');
    fixture.lists.pods = {
      status: 'partial',
      failures: [forbidden('kube-system')],
      scopedTo: ['kube-system', 'shop'],
    };
    renderView();

    expect(screen.getByText(/\(may be incomplete\)$/)).toBeTruthy();
    expect(
      screen.getByText('Pods could only be partly listed: HTTP 403 Forbidden in kube-system.')
    ).toBeTruthy();
    expect(screen.getByText('Needs list and watch on pods in kube-system.')).toBeTruthy();
    expect(screen.getByText(/Only the allowed namespaces/)).toBeTruthy();
    expect(screen.queryByText(/Missing/)).toBeNull();
    expect(screen.getByText('No node agents (DaemonSets) target this pool.')).toBeTruthy();
  }, 60_000);
});
