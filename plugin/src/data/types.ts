/**
 * Minimal structural types for the Kubernetes JSON this plugin reads.
 * The pure functions take plain JSON (KubeObject.jsonData) so they can be unit tested
 * without loading Headlamp.
 */

export type ResourceMap = Record<string, string | undefined>;

export interface ObjectMeta {
  name: string;
  namespace?: string;
  uid?: string;
  labels?: Record<string, string>;
  ownerReferences?: Array<{ kind: string; name: string; uid?: string; controller?: boolean }>;
  deletionTimestamp?: string;
}

export interface Taint {
  key: string;
  value?: string;
  effect: 'NoSchedule' | 'PreferNoSchedule' | 'NoExecute' | string;
}

export interface Toleration {
  key?: string;
  operator?: 'Exists' | 'Equal' | string;
  value?: string;
  effect?: string;
  tolerationSeconds?: number;
}

export interface NodeSelectorRequirement {
  key: string;
  operator: 'In' | 'NotIn' | 'Exists' | 'DoesNotExist' | 'Gt' | 'Lt' | string;
  values?: string[];
}

export interface NodeSelectorTerm {
  matchExpressions?: NodeSelectorRequirement[];
  matchFields?: NodeSelectorRequirement[];
}

export interface ContainerJson {
  name: string;
  restartPolicy?: string;
  resources?: { requests?: ResourceMap; limits?: ResourceMap };
}

export interface PodSpecJson {
  nodeName?: string;
  nodeSelector?: Record<string, string>;
  hostNetwork?: boolean;
  affinity?: {
    nodeAffinity?: {
      requiredDuringSchedulingIgnoredDuringExecution?: { nodeSelectorTerms?: NodeSelectorTerm[] };
    };
  };
  tolerations?: Toleration[];
  containers?: ContainerJson[];
  initContainers?: ContainerJson[];
  overhead?: ResourceMap;
  resources?: { requests?: ResourceMap; limits?: ResourceMap };
}

export interface NodeJson {
  metadata: ObjectMeta;
  spec?: { taints?: Taint[]; unschedulable?: boolean };
  status?: {
    allocatable?: ResourceMap;
    capacity?: ResourceMap;
    conditions?: Array<{ type: string; status: string }>;
  };
}

export interface PodJson {
  metadata: ObjectMeta;
  spec?: PodSpecJson;
  status?: { phase?: string };
}

export interface DaemonSetJson {
  metadata: ObjectMeta;
  spec?: { template?: { spec?: PodSpecJson } };
  status?: {
    desiredNumberScheduled?: number;
    currentNumberScheduled?: number;
    numberReady?: number;
    numberMisscheduled?: number;
  };
}

/** CPU in millicores and memory in bytes. */
export interface CpuMem {
  cpuMillicores: number;
  memoryBytes: number;
}
