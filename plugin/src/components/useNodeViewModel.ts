import { useMemo } from 'react';
import { useHistory, useLocation } from 'react-router-dom';
import {
  buildNodePoolView,
  ListedResource,
  ListState,
  NodePoolView,
  useClusterResources,
} from '../data';
import {
  podKey,
  PodStatusJson,
  PodUiStatus,
  podUiStatus,
  poolFromSearch,
  searchWithPool,
} from './presentation';

export interface NodeViewModel extends NodePoolView {
  loading: boolean;
  /** Per list status; failed or partial lists are explained to the user, not shown as empty. */
  lists: Record<ListedResource, ListState>;
  /** Pool id from the URL, if any. May differ from selectedPoolId when the URL names an unknown pool. */
  requestedPoolId?: string;
  setPool: (poolId: string) => void;
  /** Headlamp pod status and reason per podKey. */
  podStatus: Map<string, PodUiStatus>;
}

/**
 * Same composition as useNodePoolView (useClusterResources + buildNodePoolView), plus:
 * the selected pool lives in the `pool` URL query parameter so the view deep-links,
 * and pod readiness/reason are derived from the same watched pod list for status colors.
 */
export function useNodeViewModel(): NodeViewModel {
  const location = useLocation();
  const history = useHistory();
  const requestedPoolId = poolFromSearch(location.search);
  const { nodes, pods, daemonSets, lists, loading } = useClusterResources();

  const view = useMemo(
    () => buildNodePoolView(nodes ?? [], pods, daemonSets, requestedPoolId, lists.pods),
    [nodes, pods, daemonSets, requestedPoolId, lists.pods]
  );

  const podStatus = useMemo(() => {
    const map = new Map<string, PodUiStatus>();
    for (const p of pods ?? []) {
      const key = podKey({
        uid: p.metadata.uid,
        namespace: p.metadata.namespace ?? '',
        name: p.metadata.name,
      });
      map.set(key, podUiStatus(p as PodStatusJson));
    }
    return map;
  }, [pods]);

  const setPool = (poolId: string) => {
    history.replace({
      pathname: location.pathname,
      search: searchWithPool(location.search, poolId),
    });
  };

  return { ...view, loading, lists, requestedPoolId, setPool, podStatus };
}
