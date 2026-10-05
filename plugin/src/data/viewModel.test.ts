import { describe, expect, it } from 'vitest';
import { daemonSetCoverage } from './daemonSets';
import { daemonSet, HOSTED, NAP_DEFAULT, node, pod } from './testFixtures';
import { buildNodePoolView, groupPodsByNode } from './viewModel';

const MI = 2 ** 20;
const nodes = [
  node('aks-default-a', NAP_DEFAULT, { cpu: '2', memory: '1024Mi' }),
  node('aks-default-b', NAP_DEFAULT, { cpu: '2', memory: '1024Mi' }),
  node('aks-hostedpool-1', HOSTED, {
    taints: [{ key: 'CriticalAddonsOnly', value: 'true', effect: 'NoSchedule' }],
  }),
];

describe('groupPodsByNode', () => {
  it('skips pods without nodeName', () => {
    const g = groupPodsByNode([pod('a', 'x', 'n1'), pod('b', 'x', undefined), pod('c', 'x', 'n1')]);
    expect([...g.keys()]).toEqual(['n1']);
    expect(g.get('n1')!.map(p => p.metadata.name)).toEqual(['a', 'c']);
  });
});

describe('buildNodePoolView', () => {
  const pods = [
    pod('web-1', 'shop', 'aks-default-a', { owner: { kind: 'ReplicaSet', name: 'web-rs' } }),
    pod('job-1', 'shop', 'aks-default-a', { phase: 'Succeeded' }),
    pod('coredns-1', 'kube-system', 'aks-default-a'),
    pod('pending', 'shop', undefined, { phase: 'Pending' }),
    pod('web-2', 'shop', 'aks-hostedpool-1'),
  ];

  it('defaults to the NAP default pool and splits pods', () => {
    const v = buildNodePoolView(nodes, pods, []);
    expect(v.selectedPoolId).toBe('nap/default');
    expect(v.nodes.map(n => n.name)).toEqual(['aks-default-a', 'aks-default-b']);
    const a = v.nodes[0];
    expect(a.userPods.map(p => p.name)).toEqual(['job-1', 'web-1']);
    expect(a.systemPods.map(p => p.name)).toEqual(['coredns-1']);
    expect(a.allocatable).toEqual({ cpuMillicores: 2000, memoryBytes: 1024 * MI });
    expect(a.requested).toEqual({ cpuMillicores: 200, memoryBytes: 256 * MI });
    expect(a.unallocated).toEqual({ cpuMillicores: 1800, memoryBytes: 768 * MI });
    expect(a.userPods.find(p => p.name === 'job-1')!.countsTowardRequests).toBe(false);
    expect(v.nodes[1].requested).toEqual({ cpuMillicores: 0, memoryBytes: 0 });
  });

  it('honours a valid selected pool and falls back on an unknown one', () => {
    expect(
      buildNodePoolView(nodes, pods, [], 'agentpool/hostedpool').nodes.map(n => n.name)
    ).toEqual(['aks-hostedpool-1']);
    expect(buildNodePoolView(nodes, pods, [], 'agentpool/nope').selectedPoolId).toBe('nap/default');
  });
});

describe('daemonSetCoverage', () => {
  const tolerant = daemonSet('agent', 'kube-system', { tolerations: [{ operator: 'Exists' }] });
  const plain = daemonSet('plain', 'monitoring', {});
  const windows = daemonSet('win', 'kube-system', {
    nodeSelector: { 'kubernetes.io/os': 'windows' },
  });
  const pods = [
    pod('agent-a', 'kube-system', 'aks-default-a', {
      owner: { kind: 'DaemonSet', name: 'agent', uid: 'ds-agent' },
    }),
    pod('agent-h', 'kube-system', 'aks-hostedpool-1', {
      owner: { kind: 'DaemonSet', name: 'agent', uid: 'ds-agent' },
    }),
    pod('plain-a', 'monitoring', 'aks-default-a', {
      owner: { kind: 'DaemonSet', name: 'plain', uid: 'ds-plain' },
    }),
    pod('plain-b', 'monitoring', 'aks-default-b', {
      owner: { kind: 'DaemonSet', name: 'plain', uid: 'ds-plain' },
    }),
    pod('plain-old', 'monitoring', 'aks-default-b', {
      phase: 'Failed',
      owner: { kind: 'DaemonSet', name: 'plain', uid: 'ds-plain' },
    }),
  ];

  it('reports per-pool coverage and gaps', () => {
    const scope = nodes.slice(0, 2);
    const cov = daemonSetCoverage([tolerant, plain, windows], scope, pods);
    expect(cov.map(c => c.name)).toEqual(['agent', 'plain']);
    const agent = cov[0];
    expect(agent.eligibleNodes).toEqual(['aks-default-a', 'aks-default-b']);
    expect(agent.runningNodes).toEqual(['aks-default-a']);
    expect(agent.missingNodes).toEqual(['aks-default-b']);
    expect(agent.onEveryNode).toBe(false);
    const p = cov[1];
    expect(p.onEveryNode).toBe(true);
    expect(p.onEveryEligibleNode).toBe(true);
  });

  it('taints exclude non-tolerating DaemonSets from tainted pools', () => {
    const cov = daemonSetCoverage([tolerant, plain], [nodes[2]], pods);
    expect(cov.map(c => [c.name, c.onEveryNode])).toEqual([['agent', true]]);
  });

  it('flags pods running where evaluation says not eligible', () => {
    const p = [
      pod('w', 'kube-system', 'aks-default-a', {
        owner: { kind: 'DaemonSet', name: 'win', uid: 'ds-win' },
      }),
    ];
    const cov = daemonSetCoverage([windows], nodes.slice(0, 2), p);
    expect(cov[0].unexpectedNodes).toEqual(['aks-default-a']);
  });
});

describe('buildNodePoolView with failed lists', () => {
  const pods = [
    pod('web-1', 'shop', 'aks-default-a'),
    pod('proxy-a', 'kube-system', 'aks-default-a', { owner: { kind: 'DaemonSet', name: 'proxy' } }),
  ];
  const ds = [daemonSet('proxy', 'kube-system', {}), daemonSet('agent', 'shop', {})];

  it('reports requests and coverage as unknown when pods failed, not as zero', () => {
    const v = buildNodePoolView(nodes, null, ds);
    expect(v.nodes).toHaveLength(2);
    expect(v.nodes[0].podsKnown).toBe(false);
    expect(v.nodes[0].requested).toBeNull();
    expect(v.nodes[0].unallocated).toBeNull();
    expect(v.nodes[0].allocatable.cpuMillicores).toBe(2000);
    expect(v.daemonSets).toBeNull();
  });

  it('reports coverage as unknown when DaemonSets failed, but keeps pods and requests', () => {
    const v = buildNodePoolView(nodes, pods, null);
    expect(v.daemonSets).toBeNull();
    expect(v.nodes[0].podsKnown).toBe(true);
    expect(v.nodes[0].requested).not.toBeNull();
  });

  it('leaves out DaemonSets in namespaces whose pods could not be listed', () => {
    const v = buildNodePoolView(nodes, [pods[0]], ds, undefined, {
      status: 'partial',
      failures: [{ status: 403, namespace: 'kube-system', message: 'forbidden' }],
      scopedTo: ['kube-system', 'shop'],
    });
    expect(v.daemonSets!.map(d => d.name)).toEqual(['agent']);
  });
});
