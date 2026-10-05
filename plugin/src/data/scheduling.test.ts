import { describe, expect, it } from 'vitest';
import {
  daemonSetShouldRunOnNode,
  matchesNodeSelectorAndAffinity,
  toleratesTaint,
} from './scheduling';
import { HOSTED, NAP_DEFAULT, node } from './testFixtures';

const CRITICAL = { key: 'CriticalAddonsOnly', value: 'true', effect: 'NoSchedule' };

describe('toleratesTaint', () => {
  it('Exists with empty key tolerates everything for the effect', () => {
    expect(toleratesTaint({ operator: 'Exists', effect: 'NoSchedule' }, CRITICAL)).toBe(true);
    expect(toleratesTaint({ operator: 'Exists', effect: 'NoExecute' }, CRITICAL)).toBe(false);
    expect(toleratesTaint({ operator: 'Exists' }, CRITICAL)).toBe(true);
  });
  it('Exists with key ignores value', () => {
    expect(toleratesTaint({ key: 'CriticalAddonsOnly', operator: 'Exists' }, CRITICAL)).toBe(true);
  });
  it('Equal compares value and defaults operator to Equal', () => {
    expect(toleratesTaint({ key: 'CriticalAddonsOnly', value: 'true' }, CRITICAL)).toBe(true);
    expect(toleratesTaint({ key: 'CriticalAddonsOnly', value: 'false' }, CRITICAL)).toBe(false);
  });
});

describe('matchesNodeSelectorAndAffinity', () => {
  const n = node('a', {
    ...NAP_DEFAULT,
    'karpenter.azure.com/aksnodeclass': 'default',
    'karpenter.azure.com/sku-cpu': '4',
  });
  const term = (key: string, operator: string, values?: string[]) => ({
    affinity: {
      nodeAffinity: {
        requiredDuringSchedulingIgnoredDuringExecution: {
          nodeSelectorTerms: [{ matchExpressions: [{ key, operator, values }] }],
        },
      },
    },
  });

  it('nodeSelector must match all pairs', () => {
    expect(
      matchesNodeSelectorAndAffinity(n, { nodeSelector: { 'kubernetes.io/os': 'linux' } })
    ).toBe(true);
    expect(
      matchesNodeSelectorAndAffinity(n, { nodeSelector: { 'kubernetes.io/os': 'windows' } })
    ).toBe(false);
  });

  it.each([
    ['kubernetes.io/os', 'In', ['linux'], true],
    ['kubernetes.io/os', 'NotIn', ['linux'], false],
    ['type', 'NotIn', ['virtual-kubelet'], true],
    ['karpenter.azure.com/aksnodeclass', 'Exists', undefined, true],
    ['karpenter.azure.com/aksnodeclass', 'DoesNotExist', undefined, false],
    ['karpenter.azure.com/sku-cpu', 'Gt', ['2'], true],
    ['karpenter.azure.com/sku-cpu', 'Lt', ['2'], false],
  ])('%s %s %j -> %s', (key, op, values, expected) => {
    expect(matchesNodeSelectorAndAffinity(n, term(key, op, values))).toBe(expected);
  });

  it('terms are ORed and empty terms match nothing', () => {
    const spec = {
      affinity: {
        nodeAffinity: {
          requiredDuringSchedulingIgnoredDuringExecution: {
            nodeSelectorTerms: [
              {},
              { matchFields: [{ key: 'metadata.name', operator: 'In', values: ['a'] }] },
            ],
          },
        },
      },
    };
    expect(matchesNodeSelectorAndAffinity(n, spec)).toBe(true);
    expect(matchesNodeSelectorAndAffinity(node('b', {}), spec)).toBe(false);
  });
});

describe('daemonSetShouldRunOnNode', () => {
  const tainted = node('h', HOSTED, {
    taints: [CRITICAL, { key: 'CriticalAddonsOnly', value: 'true', effect: 'NoExecute' }],
  });

  it('blocked by untolerated NoSchedule/NoExecute taints', () => {
    expect(daemonSetShouldRunOnNode(tainted, {})).toBe(false);
    expect(
      daemonSetShouldRunOnNode(tainted, {
        tolerations: [{ key: 'CriticalAddonsOnly', operator: 'Exists' }],
      })
    ).toBe(true);
  });

  it('ignores PreferNoSchedule taints', () => {
    const n = node('p', {}, { taints: [{ key: 'x', effect: 'PreferNoSchedule' }] });
    expect(daemonSetShouldRunOnNode(n, {})).toBe(true);
  });

  it('applies DaemonSet controller default tolerations', () => {
    const n = node(
      'c',
      {},
      { taints: [{ key: 'node.kubernetes.io/unschedulable', effect: 'NoSchedule' }] }
    );
    expect(daemonSetShouldRunOnNode(n, {})).toBe(true);
    const net = node(
      'd',
      {},
      { taints: [{ key: 'node.kubernetes.io/network-unavailable', effect: 'NoSchedule' }] }
    );
    expect(daemonSetShouldRunOnNode(net, {})).toBe(false);
    expect(daemonSetShouldRunOnNode(net, { hostNetwork: true })).toBe(true);
  });
});
