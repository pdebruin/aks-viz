import { Link, PercentageBar, StatusLabel } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import { useTheme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';
import React from 'react';
import type { CpuMem, DaemonSetCoverage, NodeView, PodView } from '../data';
import { AgentRowItem, statusColor, WorkloadRow } from './PodItems';
import {
  commonNamespace,
  formatNodeResource,
  formatNodeResourceUnknown,
  formatRequestTotal,
  groupNodePods,
  isAgentProblem,
  nodeAgentRows,
  plural,
  podKey,
  PodUiStatus,
  ResourceKind,
  sortWorkloadPods,
  summarizeNodeAgents,
  sumRequests,
  workloadKey,
} from './presentation';

/** Height of the workload area before it scrolls: about 18 rows plus two group headers. */
const WORKLOAD_AREA_MAX_HEIGHT = 520;

/** Shown instead of a bar when the pod list failed: allocatable is known, requests are not. */
function UnknownResourceRow(props: { kind: ResourceKind; allocatable: CpuMem }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
      <Typography variant="caption" sx={{ width: 32, flex: '0 0 auto' }}>
        {props.kind === 'cpu' ? 'CPU' : 'Mem'}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {formatNodeResourceUnknown(props.kind, props.allocatable)}
      </Typography>
    </Box>
  );
}

function ResourceRow(props: {
  kind: ResourceKind;
  requested: CpuMem | null;
  allocatable: CpuMem;
  unallocated: CpuMem | null;
}) {
  if (!props.requested || !props.unallocated) {
    return <UnknownResourceRow kind={props.kind} allocatable={props.allocatable} />;
  }
  return (
    <KnownResourceRow
      kind={props.kind}
      requested={props.requested}
      allocatable={props.allocatable}
      unallocated={props.unallocated}
    />
  );
}

function KnownResourceRow(props: {
  kind: ResourceKind;
  requested: CpuMem;
  allocatable: CpuMem;
  unallocated: CpuMem;
}) {
  const { kind, requested, allocatable } = props;
  const theme = useTheme();
  const pick = (c: CpuMem) => (kind === 'cpu' ? c.cpuMillicores : c.memoryBytes);
  const total = pick(allocatable);
  const used = Math.min(pick(requested), total);
  const over = pick(requested) > total;
  const text = formatNodeResource(kind, requested, allocatable, props.unallocated);
  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography variant="caption" sx={{ width: 32, flex: '0 0 auto' }}>
          {kind === 'cpu' ? 'CPU' : 'Mem'}
        </Typography>
        <Box sx={{ flex: 1, minWidth: 0 }} aria-hidden>
          <PercentageBar
            data={[
              {
                name: 'Requested',
                value: used,
                fill: over ? theme.palette.error.main : undefined,
              },
            ]}
            total={total > 0 ? total : 1}
          />
        </Box>
      </Box>
      <Typography variant="caption" component="div" color="text.secondary" sx={{ pl: 5 }}>
        {text}
      </Typography>
    </Box>
  );
}

function NodeState({ node }: { node: NodeView }) {
  return (
    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
      <StatusLabel status={node.ready ? 'success' : 'error'}>
        {node.ready ? 'Ready' : 'NotReady'}
      </StatusLabel>
      {node.unschedulable && <StatusLabel status="warning">Cordoned</StatusLabel>}
    </Box>
  );
}

/** Group header: label with count on the left, the group's summed requests on the right. */
function GroupHeader(props: { label: string; requests?: CpuMem; children?: React.ReactNode }) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 1,
        px: 1.5,
        pt: 1,
        pb: 0.5,
      }}
    >
      <Typography variant="caption" component="h4" sx={{ fontWeight: 600, color: 'text.primary' }}>
        {props.label}
      </Typography>
      {props.children}
      {props.requests && (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ ml: 'auto', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}
          title="Requests of this group"
        >
          {formatRequestTotal(props.requests)}
        </Typography>
      )}
    </Box>
  );
}

/** "in kube-system" when every pod of a group shares one namespace; rows then leave it out. */
function NamespaceNote({ namespace }: { namespace?: string }) {
  if (!namespace) return null;
  return (
    <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
      in {namespace}
    </Typography>
  );
}

function EmptyLine({ children }: { children: React.ReactNode }) {
  return (
    <Typography
      variant="body2"
      color="text.secondary"
      sx={{ px: 1.5, pb: 0.75, fontSize: '0.8125rem' }}
    >
      {children}
    </Typography>
  );
}

export function NodeColumn(props: {
  node: NodeView;
  podStatus: Map<string, PodUiStatus>;
  /** Null when coverage is unknown (DaemonSet or pod list failed); agent pods are then listed without gaps. */
  daemonSets: DaemonSetCoverage[] | null;
  /** Nodes in the pool per workload key, to decide which rows get an identity color. */
  workloadNodes: Map<string, number>;
  /** Identity color per workload key, only for workloads on more than one node. */
  workloadColors: Map<string, string>;
  agentsExpanded: boolean;
  onToggleAgents: () => void;
}) {
  const { node, podStatus, daemonSets, workloadNodes, workloadColors, agentsExpanded } = props;
  const theme = useTheme();
  const statusOf = (p: PodView) => podStatus.get(podKey(p));
  const uiStatusOf = (p: PodView) => statusOf(p)?.status ?? '';
  const groups = groupNodePods(node);
  const user = sortWorkloadPods(groups.user, uiStatusOf);
  const system = sortWorkloadPods(groups.system, uiStatusOf);
  const agentRows = nodeAgentRows(node.name, groups.agents, daemonSets ?? []);
  const knownSummary = summarizeNodeAgents(agentRows, uiStatusOf);
  const agentSummary = daemonSets
    ? knownSummary
    : {
        ...knownSummary,
        text:
          knownSummary.count === 0 ? 'coverage unknown' : `${knownSummary.text}, coverage unknown`,
        status: knownSummary.status === 'warning' ? knownSummary.status : '',
      };
  const shownAgentRows = agentsExpanded
    ? agentRows
    : agentRows.filter(r => isAgentProblem(r, uiStatusOf));
  const podCount = groups.agents.length + user.length + system.length;

  // Show the instance suffix only where it tells rows apart: StatefulSet ordinals and same-node replicas.
  const perNode = new Map<string, number>();
  for (const p of [...user, ...system]) {
    perNode.set(workloadKey(p), (perNode.get(workloadKey(p)) ?? 0) + 1);
  }
  const userNs = commonNamespace(user);
  const systemNs = commonNamespace(system);
  const row = (sharedNamespace?: string) => (p: PodView) => {
    const key = workloadKey(p);
    const nodes = workloadNodes.get(key) ?? 1;
    return (
      <WorkloadRow
        key={podKey(p)}
        pod={p}
        st={statusOf(p)}
        identityColor={workloadColors.get(key)}
        nodesWithWorkload={nodes}
        showInstance={p.ownerKind === 'StatefulSet' || (perNode.get(key) ?? 0) > 1}
        showNamespace={!sharedNamespace}
      />
    );
  };

  return (
    <Paper
      variant="outlined"
      component="section"
      aria-label={`Node ${node.name}`}
      sx={{ display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}
    >
      <Box sx={{ p: 1.5, borderBottom: `1px solid ${theme.palette.divider}` }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
          <Typography
            variant="subtitle2"
            component="h3"
            sx={{
              flex: 1,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            <Link routeName="node" params={{ name: node.name }} title={node.name}>
              {node.name}
            </Link>
          </Typography>
          <NodeState node={node} />
        </Box>
        <Typography variant="caption" component="div" color="text.secondary" sx={{ mb: 1 }}>
          {node.poolName} · {node.mode} ·{' '}
          {node.podsKnown ? plural(podCount, 'pod') : 'pods unknown'}
        </Typography>
        <ResourceRow
          kind="cpu"
          requested={node.requested}
          allocatable={node.allocatable}
          unallocated={node.unallocated}
        />
        <ResourceRow
          kind="memory"
          requested={node.requested}
          allocatable={node.allocatable}
          unallocated={node.unallocated}
        />
      </Box>

      {!node.podsKnown ? (
        <Box sx={{ pt: 1, pb: 0.5 }}>
          <EmptyLine>Pods unknown: the pod list could not be loaded.</EmptyLine>
        </Box>
      ) : (
        <>
          <Box sx={{ borderBottom: `1px solid ${theme.palette.divider}`, pb: 0.5 }}>
            <GroupHeader
              label={`Node agents (${agentSummary.count})`}
              requests={sumRequests(groups.agents)}
            >
              <Typography
                variant="caption"
                sx={{
                  color:
                    agentSummary.status === 'warning'
                      ? statusColor(theme, 'warning')
                      : 'text.secondary',
                  fontWeight: agentSummary.status === 'warning' ? 500 : 400,
                  whiteSpace: 'nowrap',
                }}
              >
                {agentSummary.text}
              </Typography>
              {agentRows.length > 0 && (
                <Button
                  size="small"
                  onClick={props.onToggleAgents}
                  aria-expanded={agentsExpanded}
                  sx={{
                    minWidth: 0,
                    minHeight: 0,
                    p: 0,
                    textTransform: 'none',
                    fontSize: '0.75rem',
                  }}
                >
                  {agentsExpanded ? 'Hide agent list' : 'Show agent list'}
                </Button>
              )}
            </GroupHeader>
            {shownAgentRows.map(r => (
              <AgentRowItem
                key={r.kind === 'pod' ? podKey(r.pod) : `${r.kind}:${r.namespace}/${r.dsName}`}
                row={r}
                st={r.kind === 'pod' ? statusOf(r.pod) : undefined}
              />
            ))}
          </Box>

          <Box sx={{ maxHeight: WORKLOAD_AREA_MAX_HEIGHT, overflowY: 'auto', pb: 1 }}>
            <GroupHeader
              label={`User pods (${user.length})`}
              requests={user.length ? sumRequests(user) : undefined}
            >
              <NamespaceNote namespace={userNs} />
            </GroupHeader>
            {user.length ? (
              user.map(row(userNs))
            ) : (
              <EmptyLine>No user pods on this node.</EmptyLine>
            )}
            {system.length > 0 && (
              <>
                <GroupHeader
                  label={`System pods (${system.length})`}
                  requests={sumRequests(system)}
                >
                  <NamespaceNote namespace={systemNs} />
                </GroupHeader>
                {system.map(row(systemNs))}
              </>
            )}
          </Box>
        </>
      )}
    </Paper>
  );
}
