import { addCpuMem, cpuMemFromResources, maxCpuMem, ZERO } from './quantity';
import { CpuMem, PodJson } from './types';

/**
 * Effective CPU and memory requests of a pod, as the scheduler accounts for them.
 *
 * Mirrors PodRequests/AggregateContainerRequests in k8s.io/component-helpers/resource (spec path only):
 * - sum of app containers plus sidecars (init containers with restartPolicy Always);
 * - each regular init container counts as its own request plus the sidecars declared before it;
 *   the pod request is the max of that and the sum above;
 * - pod-level spec.resources.requests, when set, replace the container aggregate per resource;
 * - spec.overhead is added.
 * Not modelled: in-place resize status (status.resources / allocatedResources) and DRA claims.
 */
export function podEffectiveRequests(pod: PodJson): CpuMem {
  const spec = pod.spec ?? {};
  let reqs: CpuMem = ZERO;
  for (const c of spec.containers ?? []) {
    reqs = addCpuMem(reqs, cpuMemFromResources(c.resources?.requests));
  }

  let sidecars: CpuMem = ZERO;
  let initMax: CpuMem = ZERO;
  for (const c of spec.initContainers ?? []) {
    const own = cpuMemFromResources(c.resources?.requests);
    let use: CpuMem;
    if (c.restartPolicy === 'Always') {
      reqs = addCpuMem(reqs, own);
      sidecars = addCpuMem(sidecars, own);
      use = sidecars;
    } else {
      use = addCpuMem(own, sidecars);
    }
    initMax = maxCpuMem(initMax, use);
  }
  reqs = maxCpuMem(reqs, initMax);

  const podLevel = spec.resources?.requests;
  if (podLevel) {
    const pl = cpuMemFromResources(podLevel);
    if (podLevel.cpu !== undefined) reqs = { ...reqs, cpuMillicores: pl.cpuMillicores };
    if (podLevel.memory !== undefined) reqs = { ...reqs, memoryBytes: pl.memoryBytes };
  }

  return addCpuMem(reqs, cpuMemFromResources(spec.overhead));
}

/** Pods in a terminal phase no longer hold node resources. */
export function isTerminalPod(pod: PodJson): boolean {
  const phase = pod.status?.phase;
  return phase === 'Succeeded' || phase === 'Failed';
}

/** Sum of effective requests of non-terminal pods. */
export function sumPodRequests(pods: PodJson[]): CpuMem {
  return pods
    .filter(p => !isTerminalPod(p))
    .reduce((acc, p) => addCpuMem(acc, podEffectiveRequests(p)), ZERO);
}
