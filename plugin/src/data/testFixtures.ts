import { ContainerJson, DaemonSetJson, NodeJson, PodJson, PodSpecJson, Taint } from './types';

export function node(
  name: string,
  labels: Record<string, string>,
  opts: { taints?: Taint[]; cpu?: string; memory?: string } = {}
): NodeJson {
  return {
    metadata: { name, labels: { 'kubernetes.io/os': 'linux', ...labels } },
    spec: { taints: opts.taints ?? [] },
    status: {
      allocatable: { cpu: opts.cpu ?? '3860m', memory: opts.memory ?? '5935076Ki' },
      conditions: [{ type: 'Ready', status: 'True' }],
    },
  };
}

export function ctr(
  name: string,
  cpu?: string,
  memory?: string,
  restartPolicy?: string
): ContainerJson {
  const requests: Record<string, string> = {};
  if (cpu) requests.cpu = cpu;
  if (memory) requests.memory = memory;
  return { name, restartPolicy, resources: { requests } };
}

export function pod(
  name: string,
  namespace: string,
  nodeName: string | undefined,
  opts: {
    phase?: string;
    containers?: ContainerJson[];
    initContainers?: ContainerJson[];
    owner?: { kind: string; name: string; uid?: string };
    spec?: Partial<PodSpecJson>;
  } = {}
): PodJson {
  return {
    metadata: {
      name,
      namespace,
      uid: `${namespace}-${name}`,
      ownerReferences: opts.owner ? [{ ...opts.owner, controller: true }] : undefined,
    },
    spec: {
      nodeName,
      containers: opts.containers ?? [ctr('main', '100m', '128Mi')],
      initContainers: opts.initContainers,
      ...opts.spec,
    },
    status: { phase: opts.phase ?? 'Running' },
  };
}

export function daemonSet(
  name: string,
  namespace: string,
  template: PodSpecJson,
  uid = `ds-${name}`
): DaemonSetJson {
  return {
    metadata: { name, namespace, uid },
    spec: { template: { spec: template } },
    status: { desiredNumberScheduled: 0, currentNumberScheduled: 0 },
  };
}

export const NAP_DEFAULT = {
  'karpenter.sh/nodepool': 'default',
  'kubernetes.azure.com/agentpool': '',
  'kubernetes.azure.com/mode': 'user',
};
export const NAP_SURGE = {
  'karpenter.sh/nodepool': 'system-surge',
  'kubernetes.azure.com/agentpool': '',
  'kubernetes.azure.com/mode': 'system',
};
export const HOSTED = {
  'kubernetes.azure.com/agentpool': 'hostedpool',
  'kubernetes.azure.com/mode': 'system',
};
