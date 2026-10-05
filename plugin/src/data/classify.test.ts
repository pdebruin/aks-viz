import { describe, expect, it } from 'vitest';
import { classifyPod } from './classify';
import { pod } from './testFixtures';

describe('classifyPod', () => {
  it.each([
    ['kube-system', 'system'],
    ['gatekeeper-system', 'system'],
    ['calico-system', 'system'],
    ['tigera-operator', 'system'],
    ['app-routing-system', 'system'],
    ['aks-command', 'system'],
    ['kube-node-lease', 'system'],
    ['default', 'user'],
    ['asp-demo', 'user'],
    ['my-kube-app', 'user'],
  ])('namespace %s -> %s', (ns, expected) => {
    expect(classifyPod(pod('p', ns, 'n'))).toBe(expected);
  });

  it('DaemonSet-owned pods in user namespaces are system', () => {
    expect(
      classifyPod(pod('p', 'monitoring', 'n', { owner: { kind: 'DaemonSet', name: 'agent' } }))
    ).toBe('system');
  });

  it('ReplicaSet-owned pods in user namespaces are user', () => {
    expect(classifyPod(pod('p', 'web', 'n', { owner: { kind: 'ReplicaSet', name: 'rs' } }))).toBe(
      'user'
    );
  });
});
