import { K8s } from '@kinvolk/headlamp-plugin/lib';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  LIST_RETRY_MS,
  ListedResource,
  ListResult,
  ListState,
  mergeListUpdate,
  toListResult,
} from './listState';
import { DaemonSetJson, NodeJson, PodJson } from './types';
import { buildNodePoolView, NodePoolView } from './viewModel';

export interface ClusterResources {
  /** Null while loading or when the list failed; see lists for why. */
  nodes: NodeJson[] | null;
  pods: PodJson[] | null;
  daemonSets: DaemonSetJson[] | null;
  /** Per list: loading, ok, partial or failed, with the failed requests (HTTP status, namespace). */
  lists: Record<ListedResource, ListState>;
  /** True while any list has neither returned items nor failed. */
  loading: boolean;
}

const RESOURCES: ListedResource[] = ['nodes', 'pods', 'daemonsets'];

/** The part of a Headlamp resource class used here; useList's result also has items and errors fields. */
interface ListableClass {
  isNamespaced: boolean;
  useList(): { items: Array<{ jsonData: unknown }> | null; errors: unknown[] | null };
}

const CLASSES = {
  nodes: K8s.ResourceClasses.Node,
  pods: K8s.ResourceClasses.Pod,
  daemonsets: K8s.ResourceClasses.DaemonSet,
} as unknown as Record<ListedResource, ListableClass>;

type Results = Record<ListedResource, ListResult<unknown>>;

const LOADING: ListResult<unknown> = {
  items: null,
  state: { status: 'loading', failures: [], scopedTo: [] },
};

function errorKey(errors: unknown[] | null | undefined): string {
  return (errors ?? [])
    .map(e => {
      const x = (e ?? {}) as { status?: number; namespace?: string; message?: string };
      return `${x.status ?? ''}|${x.namespace ?? ''}|${x.message ?? String(e)}`;
    })
    .join('\n');
}

/**
 * One watched list. Rendered with a key so a failed list can be remounted, which makes Headlamp's
 * query layer request it again (it does not retry a failed list by itself after the first attempts).
 * Lists that work are never remounted, so their watches keep running.
 */
const ListSource = React.memo(function ListSource(props: {
  resource: ListedResource;
  allowedNamespaces: string;
  onUpdate: (resource: ListedResource, result: ListResult<unknown>) => void;
}) {
  const { resource, allowedNamespaces, onUpdate } = props;
  const cls = CLASSES[resource];
  const list = cls.useList();
  const items = list.items;
  const errors = list.errors;
  const errKey = errorKey(errors);
  const json = useMemo(() => (items ? items.map(i => i.jsonData as unknown) : null), [items]);
  const result = useMemo(
    () =>
      toListResult(
        json,
        errors,
        allowedNamespaces ? allowedNamespaces.split(',') : [],
        cls.isNamespaced
      ),
    // errors is a new array on every render; errKey captures its content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [json, errKey, allowedNamespaces, cls]
  );
  useEffect(() => onUpdate(resource, result), [resource, result, onUpdate]);
  return null;
});

const ClusterResourcesContext = createContext<ClusterResources | null>(null);

/**
 * Cluster-wide watch-based lists of Nodes, Pods (all namespaces) and DaemonSets for the current
 * cluster, shared with useClusterResources. Uses Headlamp's useList, which watches by default; do
 * not pass refetchInterval, it disables watching. A list that fails (for example 403) is reported
 * per resource and requested again every LIST_RETRY_MS; the other lists keep working.
 * RBAC needed: list and watch on nodes, pods and daemonsets.
 */
export function ClusterResourcesProvider(props: { children?: React.ReactNode }) {
  const [results, setResults] = useState<Results>({
    nodes: LOADING,
    pods: LOADING,
    daemonsets: LOADING,
  });
  const [attempt, setAttempt] = useState<Record<ListedResource, number>>({
    nodes: 0,
    pods: 0,
    daemonsets: 0,
  });
  const allowedNamespaces = (K8s.cluster?.getAllowedNamespaces?.() ?? []).join(',');

  const onUpdate = useCallback((resource: ListedResource, next: ListResult<unknown>) => {
    setResults(prev => ({ ...prev, [resource]: mergeListUpdate(prev[resource], next) }));
  }, []);

  const failing = RESOURCES.filter(r => {
    const s = results[r].state.status;
    return s === 'failed' || s === 'partial';
  }).join(',');
  useEffect(() => {
    if (!failing) return;
    const timer = setInterval(() => {
      setAttempt(prev => {
        const next = { ...prev };
        for (const r of failing.split(',') as ListedResource[]) next[r] = prev[r] + 1;
        return next;
      });
    }, LIST_RETRY_MS);
    return () => clearInterval(timer);
  }, [failing]);

  const value = useMemo<ClusterResources>(
    () => ({
      nodes: results.nodes.items as NodeJson[] | null,
      pods: results.pods.items as PodJson[] | null,
      daemonSets: results.daemonsets.items as DaemonSetJson[] | null,
      lists: {
        nodes: results.nodes.state,
        pods: results.pods.state,
        daemonsets: results.daemonsets.state,
      },
      loading: RESOURCES.some(r => results[r].state.status === 'loading'),
    }),
    [results]
  );

  return React.createElement(
    ClusterResourcesContext.Provider,
    { value },
    ...RESOURCES.map(r =>
      React.createElement(ListSource, {
        key: `${r}:${attempt[r]}`,
        resource: r,
        allowedNamespaces,
        onUpdate,
      })
    ),
    props.children
  );
}

/** The lists provided by the nearest ClusterResourcesProvider. */
export function useClusterResources(): ClusterResources {
  const value = useContext(ClusterResourcesContext);
  if (!value) throw new Error('useClusterResources must be used inside ClusterResourcesProvider');
  return value;
}

export interface UseNodePoolViewResult extends NodePoolView {
  loading: boolean;
  lists: Record<ListedResource, ListState>;
}

/**
 * View model for one node pool, recomputed when any watched list changes.
 * Pass undefined to get the default pool (NAP "default", else first System agent pool).
 */
export function useNodePoolView(selectedPoolId?: string): UseNodePoolViewResult {
  const { nodes, pods, daemonSets, lists, loading } = useClusterResources();
  const view = useMemo(
    () => buildNodePoolView(nodes ?? [], pods, daemonSets, selectedPoolId, lists.pods),
    [nodes, pods, daemonSets, selectedPoolId, lists.pods]
  );
  return { ...view, loading, lists };
}
