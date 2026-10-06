import { K8s } from '@kinvolk/headlamp-plugin/lib';
import {
  Link,
  Loader,
  PercentageBar,
  SectionBox,
  StatusLabel,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import { useTheme } from '@mui/material/styles';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import React, { useMemo, useState } from 'react';
import { useHistory, useLocation } from 'react-router-dom';
import {
  buildView,
  cores,
  gib,
  NodeJson,
  NodeView as NodeData,
  plural,
  PodJson,
  podRequestsText,
  PodView,
  sumRequests,
  workloadColors,
} from './model';

type ApiError = { status?: number; namespace?: string; message?: string };
interface Listable {
  useList(opts: { cluster?: string }): {
    items: Array<{ jsonData: unknown }> | null;
    errors: ApiError[] | null;
  };
}

/**
 * Watched list (Headlamp useList, no polling) for the page's cluster. useList without a cluster
 * lists every selected cluster, which would merge nodes and pods of different clusters.
 * A list with any error is treated as unknown, so nothing derived from it is shown as valid.
 */
function useJsonList<T>(cls: unknown, cluster: string | null) {
  const { items, errors } = (cls as Listable).useList({ cluster: cluster ?? undefined });
  const json = useMemo(() => items?.map(i => i.jsonData as T) ?? null, [items]);
  const failed = !!errors?.length;
  return {
    items: failed ? null : json,
    errors: failed ? errors : null,
    loading: !failed && !items,
  };
}

const RBAC = {
  Nodes: 'list and watch on nodes (cluster-scoped, so a ClusterRole)',
  Pods: 'list and watch on pods',
};

function ListError({ kind, errors }: { kind: 'Nodes' | 'Pods'; errors: ApiError[] }) {
  const uniq = (xs: Array<string | undefined>) => [...new Set(xs.filter(Boolean))].join(', ');
  const statuses = uniq(errors.map(e => (e.status ? `HTTP ${e.status}` : 'no HTTP status')));
  const ns = uniq(errors.map(e => e.namespace));
  const scope = kind === 'Nodes' ? '' : ns ? ` in ${ns}` : ' in all namespaces';
  return (
    <Alert severity="error" sx={{ mb: 1 }}>
      <AlertTitle>
        {kind} could not be listed{ns && ` in ${ns}`}: {statuses}
      </AlertTitle>
      {kind === 'Nodes'
        ? 'No node pools or nodes can be shown.'
        : 'Pods and requests are unknown, so they are not shown.'}
      {errors.some(e => e.status === 403) && ` Needs ${RBAC[kind]}${scope}.`}{' '}
      {uniq(errors.map(e => e.message))}
    </Alert>
  );
}

const GAP = 16;
/** A third of the row for up to 3 nodes, else a quarter, at least 340px (then it wraps). */
function gridColumns(nodeCount: number): string {
  const perRow = nodeCount <= 3 ? 3 : 4;
  const share = `calc((100% - ${(perRow - 1) * GAP}px) / ${perRow})`;
  return `repeat(auto-fill, minmax(min(100%, max(340px, ${share})), 1fr))`;
}

const SOURCE = { nap: 'NAP', agentpool: 'agent pool', unknown: 'unknown' };

/** Pods per node for one node pool. Layout: docs/layout.md option C. */
export function NodeView() {
  const cluster = K8s.useCluster();
  const nodes = useJsonList<NodeJson>(K8s.ResourceClasses.Node, cluster);
  const pods = useJsonList<PodJson>(K8s.ResourceClasses.Pod, cluster);
  const location = useLocation();
  const history = useHistory();
  const requestedPool = new URLSearchParams(location.search).get('pool') || undefined;
  const view = useMemo(
    () => buildView(nodes.items ?? [], pods.items, requestedPool),
    [nodes.items, pods.items, requestedPool]
  );
  const colors = useMemo(() => workloadColors(view.nodes), [view.nodes]);
  // One toggle for all columns; a single node has room to list its agents.
  const [agentsToggled, setAgentsToggled] = useState<boolean>();
  const agentsOpen = agentsToggled ?? view.nodes.length === 1;

  if (nodes.loading || pods.loading) return <Loader title="Loading nodes and pods" />;

  const all = view.nodes.flatMap(n => n.pods);
  const count = (g: PodView['group']) => all.filter(p => p.group === g).length;
  const subtitle = nodes.errors
    ? 'Nodes unknown'
    : `${plural(view.nodes.length, 'node')}, ` +
      (pods.errors
        ? 'pods unknown'
        : `${plural(all.length, 'pod')}: ${count('user')} user, ${count('system')} system, ` +
          plural(count('agent'), 'node agent'));

  const setPool = (pool: string) => {
    const params = new URLSearchParams(location.search);
    params.set('pool', pool);
    history.replace({ pathname: location.pathname, search: `?${params}` });
  };
  const poolSelector = (
    <TextField
      key="pool"
      select
      size="small"
      label="Node pool"
      value={view.selectedPoolId ?? ''}
      onChange={e => setPool(e.target.value)}
      disabled={view.pools.length === 0}
      sx={{ minWidth: 300 }}
    >
      {view.pools.map(p => (
        <MenuItem key={p.id} value={p.id}>
          {p.name}
          {p.id === view.defaultPoolId && p.name !== 'default' && ' (default)'} · {SOURCE[p.source]}
          , {p.mode}, {plural(p.nodes, 'node')}
        </MenuItem>
      ))}
    </TextField>
  );

  return (
    <SectionBox title="Node view" subtitle={subtitle} headerProps={{ actions: [poolSelector] }}>
      {nodes.errors && <ListError kind="Nodes" errors={nodes.errors} />}
      {pods.errors && <ListError kind="Pods" errors={pods.errors} />}
      {requestedPool && requestedPool !== view.selectedPoolId && !nodes.errors && (
        <Alert severity="info" sx={{ mb: 1 }}>
          Node pool {requestedPool} was not found. Showing {view.selectedPoolId ?? 'no pool'}{' '}
          instead.
        </Alert>
      )}
      {nodes.errors ? null : view.nodes.length === 0 ? (
        <Typography color="text.secondary" sx={{ py: 2 }}>
          {view.pools.length === 0 ? 'No nodes found.' : 'This node pool has no nodes.'}
        </Typography>
      ) : (
        <>
          <Typography variant="caption" component="p" color="text.secondary" sx={{ mb: 1 }}>
            Node agents are DaemonSet pods, one per node. A colored edge marks a workload that runs
            on more than one node. Requests are shown as CPU · memory.
          </Typography>
          <Box
            sx={{
              display: 'grid',
              gap: `${GAP}px`,
              gridTemplateColumns: gridColumns(view.nodes.length),
              // PercentageBar sets z-index: theme.zIndex.drawer on a positioned recharts wrapper;
              // contain it so it cannot paint over the details drawer.
              isolation: 'isolate',
            }}
          >
            {view.nodes.map(n => (
              <NodeColumn
                key={n.name}
                node={n}
                colors={colors}
                agentsOpen={agentsOpen}
                onToggleAgents={() => setAgentsToggled(!agentsOpen)}
              />
            ))}
          </Box>
        </>
      )}
    </SectionBox>
  );
}

function ResourceRow({ kind, node }: { kind: 'cpu' | 'mem'; node: NodeData }) {
  const theme = useTheme();
  const alloc = node.allocatable[kind];
  const req = node.requested?.[kind];
  const [fmt, unit] = kind === 'cpu' ? [cores, 'cores'] : [gib, 'GiB'];
  const text =
    req === undefined
      ? `requests unknown, ${fmt(alloc)} ${unit} allocatable`
      : `${fmt(req)} / ${fmt(alloc)} ${unit} requested, ` +
        (req > alloc ? `over by ${fmt(req - alloc)}` : `${fmt(alloc - req)} unallocated`);
  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography variant="caption" sx={{ width: 32, flex: 'none' }}>
          {kind === 'cpu' ? 'CPU' : 'Mem'}
        </Typography>
        {req !== undefined && (
          <Box sx={{ flex: 1, minWidth: 0 }} aria-hidden>
            <PercentageBar
              data={[
                {
                  name: 'Requested',
                  value: Math.min(req, alloc),
                  fill: req > alloc ? theme.palette.error.main : undefined,
                },
              ]}
              total={alloc > 0 ? alloc : 1}
            />
          </Box>
        )}
      </Box>
      <Typography variant="caption" component="div" color="text.secondary" sx={{ pl: 5 }}>
        {text}
      </Typography>
    </Box>
  );
}

const small = { fontSize: '0.75rem', color: 'text.secondary', whiteSpace: 'nowrap' } as const;
const ellipsis = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

function PodRow({ pod, color }: { pod: PodView; color?: string }) {
  const theme = useTheme();
  const dot = pod.status ? theme.palette[pod.status].main : theme.palette.grey[500];
  return (
    <Box
      title={`${pod.namespace}/${pod.name}: ${pod.reason}`}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.75,
        minHeight: 26,
        pl: 1,
        pr: 1.5,
        fontSize: '0.8125rem',
        borderLeft: `4px solid ${color ?? theme.palette.divider}`,
        opacity: pod.faded ? 0.6 : 1,
        '&:hover': { bgcolor: 'action.hover' },
      }}
    >
      <Box
        component="span"
        sx={{ flex: 'none', width: 8, height: 8, borderRadius: '50%', bgcolor: dot }}
      />
      <Box component="span" sx={ellipsis}>
        <Link
          routeName="Pod"
          params={{ namespace: pod.namespace, name: pod.name }}
          aria-label={`${pod.namespace}/${pod.name}: ${pod.reason}`}
        >
          {pod.workload}
        </Link>
      </Box>
      <Box component="span" sx={small}>
        {pod.instance}
      </Box>
      <Box component="span" sx={{ ...small, ...ellipsis }}>
        {pod.namespace}
      </Box>
      {pod.reason !== 'Running' && pod.reason !== 'Succeeded' && (
        <Box
          component="span"
          sx={{
            ...ellipsis,
            ...small,
            fontWeight: 500,
            color: pod.status ? dot : 'text.secondary',
          }}
        >
          {pod.reason}
        </Box>
      )}
      <Box
        component="span"
        sx={{ ...small, ml: 'auto', pl: 1, fontVariantNumeric: 'tabular-nums' }}
      >
        {podRequestsText(pod.requests)}
      </Box>
    </Box>
  );
}

/** Group header: label and note on the left, summed requests of counted pods on the right. */
function GroupHeader(props: { label: string; pods: PodView[]; children?: React.ReactNode }) {
  const r = sumRequests(props.pods.filter(p => p.counts));
  return (
    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, px: 1.5, pt: 1, pb: 0.5 }}>
      <Typography variant="caption" component="h4" sx={{ fontWeight: 600 }}>
        {props.label}
      </Typography>
      {props.children}
      {props.pods.length > 0 && (
        <Box component="span" sx={{ ...small, ml: 'auto' }}>
          {cores(r.cpu)} cores, {gib(r.mem)} GiB
        </Box>
      )}
    </Box>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <Typography variant="body2" color="text.secondary" sx={{ px: 1.5, py: 0.75 }}>
      {children}
    </Typography>
  );
}

function NodeColumn(props: {
  node: NodeData;
  colors: Map<string, string>;
  agentsOpen: boolean;
  onToggleAgents: () => void;
}) {
  const { node, colors, agentsOpen } = props;
  const theme = useTheme();
  const of = (g: PodView['group']) => node.pods.filter(p => p.group === g);
  const [agents, user, system] = [of('agent'), of('user'), of('system')];
  const notReady = agents.filter(p => p.status !== 'success').length;
  const row = (p: PodView) => (
    <PodRow key={p.key} pod={p} color={colors.get(`${p.namespace}/${p.workload}`)} />
  );
  return (
    <Paper
      variant="outlined"
      component="section"
      aria-label={`Node ${node.name}`}
      sx={{ minWidth: 0, overflow: 'hidden' }}
    >
      <Box sx={{ p: 1.5, borderBottom: `1px solid ${theme.palette.divider}` }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5 }}>
          <Typography variant="subtitle2" component="h3" noWrap sx={{ flex: 1 }}>
            <Link routeName="node" params={{ name: node.name }}>
              {node.name}
            </Link>
          </Typography>
          <StatusLabel status={node.ready ? 'success' : 'error'}>
            {node.ready ? 'Ready' : 'NotReady'}
          </StatusLabel>
          {node.cordoned && <StatusLabel status="warning">Cordoned</StatusLabel>}
        </Box>
        <Typography variant="caption" component="div" color="text.secondary" sx={{ mb: 1 }}>
          {node.pool} · {node.mode} ·{' '}
          {node.requested ? plural(node.pods.length, 'pod') : 'pods unknown'}
        </Typography>
        <ResourceRow kind="cpu" node={node} />
        <ResourceRow kind="mem" node={node} />
      </Box>
      {!node.requested ? (
        <Empty>Pods unknown: the pod list could not be loaded.</Empty>
      ) : (
        <>
          <Box sx={{ borderBottom: `1px solid ${theme.palette.divider}`, pb: 0.5 }}>
            <GroupHeader label={`Node agents (${agents.length})`} pods={agents}>
              <Box
                component="span"
                sx={notReady ? { ...small, color: theme.palette.warning.main } : small}
              >
                {agents.length === 0 ? 'none' : notReady ? `${notReady} not ready` : 'all running'}
              </Box>
              {agents.length > 0 && (
                <Button
                  size="small"
                  onClick={props.onToggleAgents}
                  aria-expanded={agentsOpen}
                  sx={{ minWidth: 0, p: 0, textTransform: 'none', fontSize: '0.75rem' }}
                >
                  {agentsOpen ? 'Hide agent list' : 'Show agent list'}
                </Button>
              )}
            </GroupHeader>
            {(agentsOpen ? agents : agents.filter(p => p.status !== 'success')).map(row)}
          </Box>
          <Box sx={{ maxHeight: 520, overflowY: 'auto', pb: 1 }}>
            <GroupHeader label={`User pods (${user.length})`} pods={user} />
            {user.length ? user.map(row) : <Empty>No user pods on this node.</Empty>}
            {system.length > 0 && (
              <GroupHeader label={`System pods (${system.length})`} pods={system} />
            )}
            {system.map(row)}
          </Box>
        </>
      )}
    </Paper>
  );
}
