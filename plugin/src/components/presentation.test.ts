import { describe, expect, it } from 'vitest';
import type { DaemonSetCoverage, NodePoolInfo, NodeView, PodView } from '../data';
import {
  assignWorkloadColors,
  commonNamespace,
  describeCoverage,
  formatCores,
  formatGiB,
  formatNodeResource,
  formatPodRequests,
  formatPodRequestsShort,
  formatRequestTotal,
  groupNodePods,
  hashString,
  isAgentProblem,
  nodeAgentRows,
  percentOf,
  plural,
  podUiStatus,
  poolFromSearch,
  poolLabel,
  searchWithPool,
  sortCoverage,
  sortWorkloadPods,
  summarizeNodeAgents,
  summarizePoolAgents,
  sumRequests,
  WORKLOAD_COLORS,
  workloadColor,
  workloadKey,
  workloadName,
  workloadNodeCounts,
} from './presentation';

const GIB = 2 ** 30;
const MIB = 2 ** 20;

function pod(over: Partial<PodView>): PodView {
  return {
    name: 'p',
    namespace: 'default',
    nodeName: 'node-1',
    phase: 'Running',
    podClass: 'user',
    terminating: false,
    requests: { cpuMillicores: 0, memoryBytes: 0 },
    countsTowardRequests: true,
    ...over,
  };
}

function nodeView(over: Partial<NodeView>): NodeView {
  const zero = { cpuMillicores: 0, memoryBytes: 0 };
  return {
    name: 'node-1',
    poolId: 'agentpool/hostedpool',
    poolName: 'hostedpool',
    mode: 'System',
    ready: true,
    unschedulable: false,
    taints: [],
    allocatable: zero,
    podsKnown: true,
    requested: zero,
    unallocated: zero,
    systemPods: [],
    userPods: [],
    ...over,
  };
}

function cov(over: Partial<DaemonSetCoverage>): DaemonSetCoverage {
  return {
    namespace: 'kube-system',
    name: 'ds',
    eligibleNodes: [],
    runningNodes: [],
    missingNodes: [],
    unexpectedNodes: [],
    onEveryNode: false,
    onEveryEligibleNode: false,
    ...over,
  };
}

describe('number formatting', () => {
  it.each([
    [1234, '1.2'],
    [3860, '3.9'],
    [250, '0.25'],
    [0, '0'],
    [2000, '2'],
  ])('formatCores(%s) = %s', (m, s) => expect(formatCores(m)).toBe(s));

  it.each([
    [3.14 * GIB, '3.1'],
    [512 * MIB, '0.5'],
    [0, '0'],
  ])('formatGiB(%s) = %s', (b, s) => expect(formatGiB(b)).toBe(s));

  it('formats pod requests in manifest style', () => {
    expect(formatPodRequests({ cpuMillicores: 250, memoryBytes: 128 * MIB })).toBe(
      '250m CPU, 128Mi'
    );
    expect(formatPodRequests({ cpuMillicores: 2000, memoryBytes: 1.5 * GIB })).toBe('2 CPU, 1.5Gi');
    expect(formatPodRequests({ cpuMillicores: 0, memoryBytes: 0 })).toBe('no requests');
  });

  it('formats node CPU and memory as requested / allocatable plus unallocated', () => {
    const requested = { cpuMillicores: 1200, memoryBytes: 3.1 * GIB };
    const allocatable = { cpuMillicores: 3800, memoryBytes: 5.6 * GIB };
    const unallocated = { cpuMillicores: 2600, memoryBytes: 2.5 * GIB };
    expect(formatNodeResource('cpu', requested, allocatable, unallocated)).toBe(
      '1.2 / 3.8 cores requested, 2.6 unallocated'
    );
    expect(formatNodeResource('memory', requested, allocatable, unallocated)).toBe(
      '3.1 / 5.6 GiB requested, 2.5 unallocated'
    );
  });

  it('says "over by" when requests exceed allocatable', () => {
    expect(
      formatNodeResource(
        'cpu',
        { cpuMillicores: 2500, memoryBytes: 0 },
        { cpuMillicores: 2000, memoryBytes: 0 },
        { cpuMillicores: -500, memoryBytes: 0 }
      )
    ).toBe('2.5 / 2 cores requested, over by 0.5');
  });

  it('clamps percentages', () => {
    expect(percentOf(50, 200)).toBe(25);
    expect(percentOf(300, 200)).toBe(100);
    expect(percentOf(1, 0)).toBe(0);
  });
});

describe('podUiStatus (Headlamp pod status mapping)', () => {
  it('Running and Ready is success', () => {
    expect(
      podUiStatus({ status: { phase: 'Running', conditions: [{ type: 'Ready', status: 'True' }] } })
    ).toEqual({ status: 'success', reason: 'Running', restarts: 0 });
  });

  it('CrashLoopBackOff is warning, not error, with the container reason', () => {
    const st = podUiStatus({
      status: {
        phase: 'Running',
        conditions: [{ type: 'Ready', status: 'False' }],
        containerStatuses: [
          { name: 'app', restartCount: 7, state: { waiting: { reason: 'CrashLoopBackOff' } } },
        ],
      },
    });
    expect(st).toEqual({ status: 'warning', reason: 'CrashLoopBackOff', restarts: 7 });
  });

  it('Failed is error, Succeeded is success, Pending is grey', () => {
    expect(podUiStatus({ status: { phase: 'Failed' } }).status).toBe('error');
    expect(podUiStatus({ status: { phase: 'Succeeded' } }).status).toBe('success');
    expect(podUiStatus({ status: { phase: 'Pending' } }).status).toBe('');
    expect(podUiStatus(undefined)).toEqual({ status: '', reason: 'Unknown', restarts: 0 });
  });

  it('reports init container problems and terminating pods', () => {
    expect(
      podUiStatus({
        status: {
          phase: 'Pending',
          initContainerStatuses: [{ state: { waiting: { reason: 'ImagePullBackOff' } } }],
        },
      }).reason
    ).toBe('Init:ImagePullBackOff');
    expect(
      podUiStatus({
        metadata: { deletionTimestamp: '2026-10-05T00:00:00Z' },
        status: { phase: 'Running', conditions: [{ type: 'Ready', status: 'True' }] },
      })
    ).toMatchObject({ status: 'success', reason: 'Terminating' });
  });

  it('reports a non-zero container exit', () => {
    expect(
      podUiStatus({
        status: {
          phase: 'Running',
          containerStatuses: [{ state: { terminated: { exitCode: 137, reason: 'OOMKilled' } } }],
        },
      }).reason
    ).toBe('OOMKilled');
  });
});

describe('workload names (live pod names from my-aks-automatic)', () => {
  it.each([
    [
      {
        name: 'coredns-754ccbf9b5-2ch9b',
        ownerKind: 'ReplicaSet',
        ownerName: 'coredns-754ccbf9b5',
      },
      'coredns',
      '2ch9b',
    ],
    [
      {
        name: 'vpa-admission-controller-7794f67-ctbxg',
        ownerKind: 'ReplicaSet',
        ownerName: 'vpa-admission-controller-7794f67',
      },
      'vpa-admission-controller',
      'ctbxg',
    ],
    [
      {
        name: 'pdebruin-asp-666bd8d567-s9zgr',
        ownerKind: 'ReplicaSet',
        ownerName: 'pdebruin-asp-666bd8d567',
      },
      'pdebruin-asp',
      's9zgr',
    ],
    [
      {
        name: 'cilium-xq7p2',
        ownerKind: 'DaemonSet',
        ownerName: 'cilium',
        daemonSetName: 'cilium',
      },
      'cilium',
      'xq7p2',
    ],
    [
      {
        name: 'hubble-generate-certs-c1898c14-pmh82',
        ownerKind: 'Job',
        ownerName: 'hubble-generate-certs-c1898c14',
      },
      'hubble-generate-certs-c1898c14',
      'pmh82',
    ],
    [
      { name: 'backup-28790400-abcde', ownerKind: 'Job', ownerName: 'backup-28790400' },
      'backup',
      '28790400-abcde',
    ],
    [{ name: 'redis-0', ownerKind: 'StatefulSet', ownerName: 'redis' }, 'redis', '0'],
    [
      { name: 'etcd-node-1', ownerKind: 'Node', ownerName: 'node-1', nodeName: 'node-1' },
      'etcd',
      'node-1',
    ],
    [{ name: 'debug' }, 'debug', ''],
  ] as Array<[Partial<PodView>, string, string]>)('%o -> %s', (over, name, instance) => {
    expect(workloadName(pod(over))).toEqual({ name, instance });
  });

  it('does not strip a ReplicaSet suffix that contains a vowel (not a template hash)', () => {
    const p = pod({ name: 'web-frontend-x1', ownerKind: 'ReplicaSet', ownerName: 'web-frontend' });
    expect(workloadName(p).name).toBe('web-frontend');
  });

  it('gives every replica the same key and color, on any node', () => {
    const a = pod({
      name: 'coredns-754ccbf9b5-2ch9b',
      namespace: 'kube-system',
      ownerKind: 'ReplicaSet',
      ownerName: 'coredns-754ccbf9b5',
      nodeName: 'vms1',
    });
    const b = pod({
      name: 'coredns-754ccbf9b5-hjkbg',
      namespace: 'kube-system',
      ownerKind: 'ReplicaSet',
      ownerName: 'coredns-754ccbf9b5',
      nodeName: 'vms2',
    });
    expect(workloadKey(a)).toBe('kube-system/coredns');
    expect(workloadKey(b)).toBe(workloadKey(a));
    expect(workloadColor(workloadKey(b))).toBe(workloadColor(workloadKey(a)));
    expect(WORKLOAD_COLORS).toContain(workloadColor('kube-system/coredns'));
  });

  it('assigns distinct colors to the multi-node workloads of hostedpool', () => {
    const keys = [
      'coredns',
      'metrics-server',
      'konnectivity-agent',
      'vpa-updater',
      'vpa-recommender',
      'vpa-admission-controller',
    ].map(n => `kube-system/${n}`);
    const colors = assignWorkloadColors(keys);
    expect(new Set(colors.values()).size).toBe(6);
    expect(assignWorkloadColors([...keys].reverse())).toEqual(colors);
    const many = assignWorkloadColors(Array.from({ length: 12 }, (_, i) => `ns/w${i}`));
    expect(new Set(many.values()).size).toBe(WORKLOAD_COLORS.length);
  });

  it('spreads hashed workload colors over the palette', () => {
    const names = [
      'coredns',
      'metrics-server',
      'konnectivity-agent',
      'keda-operator',
      'vpa-updater',
      'vpa-recommender',
      'cilium-operator',
      'keda-admission-webhooks',
      'coredns-autoscaler',
      'eraser-controller-manager',
    ];
    const used = new Set(names.map(n => workloadColor(`kube-system/${n}`)));
    expect(used.size).toBeGreaterThanOrEqual(5);
    expect(hashString('abc')).toBe(hashString('abc'));
  });
});

describe('pod grouping and ordering', () => {
  it('sorts problems first, then workload name', () => {
    const a = pod({ name: 'zeta-1' });
    const b = pod({ name: 'alpha-1' });
    const c = pod({ name: 'mid-1' });
    const status = { 'zeta-1': 'success', 'alpha-1': 'success', 'mid-1': 'error' } as const;
    const sorted = sortWorkloadPods([a, b, c], p => status[p.name as keyof typeof status]);
    expect(sorted.map(p => p.name)).toEqual(['mid-1', 'alpha-1', 'zeta-1']);
  });

  it('splits node pods into agents, user and system workloads', () => {
    const n = nodeView({
      userPods: [pod({ name: 'app' }), pod({ name: 'user-ds-x', daemonSetName: 'user-ds' })],
      systemPods: [
        pod({
          name: 'cilium-a',
          namespace: 'kube-system',
          podClass: 'system',
          daemonSetName: 'cilium',
        }),
        pod({ name: 'coredns-x', namespace: 'kube-system', podClass: 'system' }),
      ],
    });
    const g = groupNodePods(n);
    expect(g.agents.map(p => p.name)).toEqual(['user-ds-x', 'cilium-a']);
    expect(g.user.map(p => p.name)).toEqual(['app']);
    expect(g.system.map(p => p.name)).toEqual(['coredns-x']);
  });

  it('counts the nodes each workload runs on, ignoring agents', () => {
    const rs = (name: string, nodeName: string) =>
      pod({
        name,
        nodeName,
        namespace: 'kube-system',
        ownerKind: 'ReplicaSet',
        ownerName: 'coredns-754ccbf9b5',
      });
    const counts = workloadNodeCounts([
      nodeView({
        name: 'vms1',
        systemPods: [rs('coredns-754ccbf9b5-a', 'vms1'), pod({ name: 'c-1', daemonSetName: 'c' })],
      }),
      nodeView({ name: 'vms2', systemPods: [rs('coredns-754ccbf9b5-b', 'vms2')] }),
    ]);
    expect(counts.get('kube-system/coredns')).toBe(2);
    expect(counts.has('default/c')).toBe(false);
  });

  it('sums requests of pods that count toward the node total', () => {
    const r = sumRequests([
      pod({ requests: { cpuMillicores: 100, memoryBytes: 64 * MIB } }),
      pod({ requests: { cpuMillicores: 250, memoryBytes: 64 * MIB } }),
      pod({ requests: { cpuMillicores: 999, memoryBytes: GIB }, countsTowardRequests: false }),
    ]);
    expect(r).toEqual({ cpuMillicores: 350, memoryBytes: 128 * MIB });
    expect(formatRequestTotal(r)).toBe('0.35 cores, 0.13 GiB');
    expect(formatPodRequestsShort({ cpuMillicores: 100, memoryBytes: 70 * MIB })).toBe(
      '100m · 70Mi'
    );
    expect(formatPodRequestsShort({ cpuMillicores: 0, memoryBytes: 0 })).toBe('none');
  });
});

describe('node agents', () => {
  const dsList = [
    cov({
      name: 'cilium',
      eligibleNodes: ['vms1', 'vms2'],
      runningNodes: ['vms1', 'vms2'],
      onEveryNode: true,
    }),
    cov({
      name: 'ama-logs',
      eligibleNodes: ['vms1', 'vms2'],
      runningNodes: ['vms1'],
      missingNodes: ['vms2'],
    }),
    cov({ name: 'gpu-plugin', eligibleNodes: ['vms1'], runningNodes: ['vms1'] }),
  ];
  const agentsOn = (nodeName: string, names: string[]) =>
    names.map(n =>
      pod({ name: `${n}-${nodeName}`, namespace: 'kube-system', nodeName, daemonSetName: n })
    );

  it('lists the same DaemonSets in the same order on every node, with gaps and ineligible rows', () => {
    const r1 = nodeAgentRows(
      'vms1',
      agentsOn('vms1', ['gpu-plugin', 'cilium', 'ama-logs']),
      dsList
    );
    const r2 = nodeAgentRows('vms2', agentsOn('vms2', ['cilium']), dsList);
    expect(r1.map(r => `${r.dsName}:${r.kind}`)).toEqual([
      'ama-logs:pod',
      'cilium:pod',
      'gpu-plugin:pod',
    ]);
    expect(r2.map(r => `${r.dsName}:${r.kind}`)).toEqual([
      'ama-logs:missing',
      'cilium:pod',
      'gpu-plugin:ineligible',
    ]);
  });

  it('keeps agent pods whose DaemonSet is not in the coverage list', () => {
    const rows = nodeAgentRows('vms1', agentsOn('vms1', ['hidden']), []);
    expect(rows).toHaveLength(1);
    expect(rows[0].dsName).toBe('hidden');
  });

  it('summarizes a node: all running, or names what needs attention', () => {
    const ok = nodeAgentRows(
      'vms1',
      agentsOn('vms1', ['gpu-plugin', 'cilium', 'ama-logs']),
      dsList
    );
    expect(summarizeNodeAgents(ok, () => 'success')).toEqual({
      count: 3,
      text: 'all running',
      status: 'success',
    });
    const bad = nodeAgentRows('vms2', agentsOn('vms2', ['cilium']), dsList);
    expect(summarizeNodeAgents(bad, () => 'warning')).toEqual({
      count: 1,
      text: '1 not ready, 1 missing',
      status: 'warning',
    });
    expect(bad.filter(r => isAgentProblem(r, () => 'success')).map(r => r.dsName)).toEqual([
      'ama-logs',
    ]);
    expect(summarizeNodeAgents([], () => 'success')).toEqual({
      count: 0,
      text: 'none',
      status: '',
    });
  });

  it('summarizes the pool with counts scoped to the pool nodes', () => {
    const nodes = [
      nodeView({
        name: 'vms1',
        systemPods: agentsOn('vms1', ['gpu-plugin', 'cilium', 'ama-logs']),
      }),
      nodeView({ name: 'vms2', systemPods: agentsOn('vms2', ['cilium']) }),
    ];
    const s = summarizePoolAgents(dsList, nodes, () => 'success');
    expect(s.text).toBe('3 node agents, 1 on every node. 4 of 4 agent pods ready.');
    expect(s.status).toBe('warning');
    expect(s.gaps.map(g => [g.ds.name, g.text])).toEqual([['ama-logs', 'Missing on vms2']]);
    expect(s.partial.map(g => [g.ds.name, g.text])).toEqual([
      ['gpu-plugin', 'On 1 of 1 eligible (2 nodes in pool)'],
    ]);

    const all = summarizePoolAgents(
      [dsList[0]],
      [nodeView({ name: 'vms1', systemPods: agentsOn('vms1', ['cilium']) })],
      () => 'success'
    );
    expect(all).toMatchObject({
      text: '1 node agent on every node. 1 of 1 agent pod ready.',
      status: 'success',
    });
  });
});

describe('labels', () => {
  it('names the shared namespace of a group, or none when mixed', () => {
    expect(
      commonNamespace([pod({ namespace: 'kube-system' }), pod({ namespace: 'kube-system' })])
    ).toBe('kube-system');
    expect(commonNamespace([pod({ namespace: 'a' }), pod({ namespace: 'b' })])).toBeUndefined();
    expect(commonNamespace([])).toBeUndefined();
  });

  it.each([
    [0, '0 nodes'],
    [1, '1 node'],
    [3, '3 nodes'],
  ])('plural(%s)', (n, s) => expect(plural(n, 'node')).toBe(s));

  const info = (over: Partial<NodePoolInfo>): NodePoolInfo => ({
    id: 'nap/default',
    name: 'default',
    source: 'nap',
    mode: 'User',
    nodeNames: ['aks-default-jw69b'],
    ...over,
  });

  it('names the default pool once', () => {
    expect(poolLabel(info({}), 'nap/default')).toBe('default · NAP, User, 1 node');
    expect(
      poolLabel(
        info({
          id: 'agentpool/hostedpool',
          name: 'hostedpool',
          source: 'agentpool',
          mode: 'System',
          nodeNames: ['a', 'b', 'c'],
        }),
        'agentpool/hostedpool'
      )
    ).toBe('hostedpool (default) · agent pool, System, 3 nodes');
    expect(poolLabel(info({ id: 'nap/x', name: 'x' }), 'nap/default')).toBe(
      'x · NAP, User, 1 node'
    );
  });
});

describe('DaemonSet coverage text', () => {
  it('on every node', () => {
    const c = cov({
      eligibleNodes: ['n1', 'n2'],
      runningNodes: ['n1', 'n2'],
      onEveryNode: true,
      onEveryEligibleNode: true,
    });
    expect(describeCoverage(c, 2)).toEqual({
      text: 'On every node',
      status: 'success',
      detail: '',
    });
  });

  it('on N of M eligible, no gap', () => {
    const c = cov({ eligibleNodes: ['n1'], runningNodes: ['n1'], onEveryEligibleNode: true });
    expect(describeCoverage(c, 3)).toEqual({
      text: 'On 1 of 1 eligible (3 nodes in pool)',
      status: 'success',
      detail: '',
    });
  });

  it('flags missing nodes', () => {
    const c = cov({
      eligibleNodes: ['n1', 'n2', 'n3'],
      runningNodes: ['n1'],
      missingNodes: ['n2', 'n3'],
    });
    expect(describeCoverage(c, 3)).toEqual({
      text: 'On 1 of 3 nodes',
      status: 'warning',
      detail: 'Missing on n2, n3',
    });
  });

  it('sorts DaemonSets with gaps first', () => {
    const ok = cov({ name: 'a' });
    const gap = cov({ name: 'z', missingNodes: ['n1'] });
    expect(sortCoverage([ok, gap]).map(c => c.name)).toEqual(['z', 'a']);
  });
});

describe('pool query parameter', () => {
  it('reads and writes pool ids with a slash', () => {
    const s = searchWithPool('?foo=1', 'nap/default');
    expect(s).toBe('?foo=1&pool=nap%2Fdefault');
    expect(poolFromSearch(s)).toBe('nap/default');
    expect(poolFromSearch('')).toBeUndefined();
    expect(searchWithPool('?pool=x', undefined)).toBe('');
  });
});
