import { describe, expect, it } from 'vitest';
import { listNodePools, nodeModeOf, nodePoolOf, selectDefaultPool } from './nodePools';
import { HOSTED, NAP_DEFAULT, NAP_SURGE, node } from './testFixtures';

describe('nodePoolOf', () => {
  it('prefers karpenter.sh/nodepool over an empty agentpool label', () => {
    expect(nodePoolOf(node('a', NAP_DEFAULT))).toEqual({
      id: 'nap/default',
      name: 'default',
      source: 'nap',
    });
  });
  it('uses agentpool for classic pools', () => {
    expect(nodePoolOf(node('a', HOSTED))).toEqual({
      id: 'agentpool/hostedpool',
      name: 'hostedpool',
      source: 'agentpool',
    });
  });
  it('falls back to unknown', () => {
    expect(nodePoolOf(node('a', {})).source).toBe('unknown');
  });
});

describe('nodeModeOf', () => {
  it('is case-insensitive', () => {
    expect(nodeModeOf(node('a', { 'kubernetes.azure.com/mode': 'System' }))).toBe('System');
    expect(nodeModeOf(node('a', { 'kubernetes.azure.com/mode': 'system' }))).toBe('System');
    expect(nodeModeOf(node('a', { 'kubernetes.azure.com/mode': 'USER' }))).toBe('User');
    expect(nodeModeOf(node('a', {}))).toBe('Unknown');
  });
});

describe('listNodePools and selectDefaultPool', () => {
  const nodes = [
    node('aks-hostedpool-1', HOSTED),
    node('aks-hostedpool-2', HOSTED),
    node('aks-default-x', NAP_DEFAULT),
    node('aks-system-surge-y', NAP_SURGE),
  ];

  it('lists pools sorted by name with modes and nodes', () => {
    const pools = listNodePools(nodes);
    expect(pools.map(p => [p.id, p.mode, p.nodeNames.length])).toEqual([
      ['nap/default', 'User', 1],
      ['agentpool/hostedpool', 'System', 2],
      ['nap/system-surge', 'System', 1],
    ]);
  });

  it('picks the NAP default NodePool when present', () => {
    expect(selectDefaultPool(listNodePools(nodes))?.id).toBe('nap/default');
  });

  it('else picks the first System-mode agent pool by name', () => {
    const classic = [
      node('u', { 'kubernetes.azure.com/agentpool': 'apps', 'kubernetes.azure.com/mode': 'User' }),
      node('s2', {
        'kubernetes.azure.com/agentpool': 'zsys',
        'kubernetes.azure.com/mode': 'System',
      }),
      node('s1', {
        'kubernetes.azure.com/agentpool': 'sys',
        'kubernetes.azure.com/mode': 'system',
      }),
      node('nap', NAP_SURGE),
    ];
    expect(selectDefaultPool(listNodePools(classic))?.id).toBe('agentpool/sys');
  });

  it('else picks the first pool by name, or undefined', () => {
    const users = [
      node('u', { 'kubernetes.azure.com/agentpool': 'b' }),
      node('v', { 'kubernetes.azure.com/agentpool': 'a' }),
    ];
    expect(selectDefaultPool(listNodePools(users))?.id).toBe('agentpool/a');
    expect(selectDefaultPool([])).toBeUndefined();
  });

  it('does not treat an agent pool named default as the NAP default', () => {
    const pools = listNodePools([
      node('a', {
        'kubernetes.azure.com/agentpool': 'default',
        'kubernetes.azure.com/mode': 'User',
      }),
      node('b', { 'kubernetes.azure.com/agentpool': 'sys', 'kubernetes.azure.com/mode': 'System' }),
    ]);
    expect(selectDefaultPool(pools)?.id).toBe('agentpool/sys');
  });
});
