import { describe, expect, it } from 'vitest';
import { podEffectiveRequests, sumPodRequests } from './podRequests';
import { ctr, pod } from './testFixtures';

const MI = 2 ** 20;

describe('podEffectiveRequests', () => {
  it('sums app containers', () => {
    const p = pod('a', 'x', 'n', {
      containers: [ctr('a', '100m', '64Mi'), ctr('b', '50m', '32Mi')],
    });
    expect(podEffectiveRequests(p)).toEqual({ cpuMillicores: 150, memoryBytes: 96 * MI });
  });

  it('treats missing requests as zero', () => {
    const p = pod('a', 'x', 'n', { containers: [{ name: 'a' }, ctr('b', undefined, '10Mi')] });
    expect(podEffectiveRequests(p)).toEqual({ cpuMillicores: 0, memoryBytes: 10 * MI });
  });

  it('takes max of largest init container and app sum, per resource', () => {
    const p = pod('a', 'x', 'n', {
      containers: [ctr('a', '100m', '64Mi'), ctr('b', '100m', '64Mi')],
      initContainers: [ctr('i1', '500m', '16Mi'), ctr('i2', '50m', '32Mi')],
    });
    expect(podEffectiveRequests(p)).toEqual({ cpuMillicores: 500, memoryBytes: 128 * MI });
  });

  it('adds sidecars to the app sum and to later init containers', () => {
    const p = pod('a', 'x', 'n', {
      containers: [ctr('app', '100m', '100Mi')],
      initContainers: [
        ctr('before', '300m', '10Mi'),
        ctr('sidecar', '50m', '50Mi', 'Always'),
        ctr('after', '300m', '10Mi'),
      ],
    });
    // app path: 100m + 50m sidecar = 150m; init path: max(300m, 50m, 300m + 50m) = 350m
    expect(podEffectiveRequests(p)).toEqual({ cpuMillicores: 350, memoryBytes: 150 * MI });
  });

  it('adds overhead and honours pod-level requests', () => {
    const p = pod('a', 'x', 'n', {
      containers: [ctr('a', '100m', '64Mi')],
      spec: { overhead: { cpu: '10m', memory: '1Mi' }, resources: { requests: { cpu: '1' } } },
    });
    expect(podEffectiveRequests(p)).toEqual({ cpuMillicores: 1010, memoryBytes: 65 * MI });
  });
});

describe('sumPodRequests', () => {
  it('skips Succeeded and Failed pods', () => {
    const pods = [
      pod('run', 'x', 'n'),
      pod('pend', 'x', 'n', { phase: 'Pending' }),
      pod('done', 'x', 'n', { phase: 'Succeeded' }),
      pod('fail', 'x', 'n', { phase: 'Failed' }),
    ];
    expect(sumPodRequests(pods)).toEqual({ cpuMillicores: 200, memoryBytes: 256 * MI });
  });
});
