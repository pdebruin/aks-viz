import { Link, Loader, SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import React, { useMemo, useState } from 'react';
import type { PodView } from '../data';
import { describeListProblems, ListProblem, podsMayBeIncomplete } from './listProblems';
import { NodeColumn } from './NodeColumn';
import { StatusDot } from './PodItems';
import {
  assignWorkloadColors,
  groupNodePods,
  plural,
  podKey,
  PoolAgentSummary,
  poolLabel,
  summarizePoolAgents,
  workloadNodeCounts,
} from './presentation';
import { useNodeViewModel } from './useNodeViewModel';

const GRID_GAP_PX = 16;
const MIN_COLUMN_PX = 340;

/**
 * Column width: a third of the row for pools of up to 3 nodes, a quarter for larger pools,
 * never narrower than MIN_COLUMN_PX (then the grid wraps to fewer columns).
 */
function gridColumns(nodeCount: number): string {
  const perRow = nodeCount <= 3 ? 3 : 4;
  const share = `calc((100% - ${(perRow - 1) * GRID_GAP_PX}px) / ${perRow})`;
  return `repeat(auto-fill, minmax(min(100%, max(${MIN_COLUMN_PX}px, ${share})), 1fr))`;
}

/** One list problem: what failed, what it means for the page, and what access would fix it. */
function ListProblemAlert({ problem }: { problem: ListProblem }) {
  return (
    <Alert severity={problem.severity} sx={{ mb: 1 }}>
      <AlertTitle>{problem.title}</AlertTitle>
      <Typography variant="body2">{problem.consequence}</Typography>
      {problem.fix && <Typography variant="body2">{problem.fix}</Typography>}
      {problem.serverMessage && (
        <Typography variant="caption" component="p" color="text.secondary" sx={{ mt: 0.5 }}>
          Server message: {problem.serverMessage}
        </Typography>
      )}
    </Alert>
  );
}

/** Pool-level node agent line: replaces the DaemonSet table. Only gaps and partial coverage get rows. */
function PoolAgentLine({ summary }: { summary: PoolAgentSummary }) {
  return (
    <Box sx={{ mb: 1.5 }} aria-label="Node agents in this pool" role="group">
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
        <StatusDot status={summary.status} />
        <Typography variant="body2">{summary.text}</Typography>
      </Box>
      {summary.gaps.map(g => (
        <Typography key={`${g.ds.namespace}/${g.ds.name}`} variant="body2" sx={{ pl: 2 }}>
          <Link routeName="DaemonSet" params={{ namespace: g.ds.namespace, name: g.ds.name }}>
            {g.ds.name}
          </Link>
          : {g.text}
        </Typography>
      ))}
      {summary.partial.length > 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ pl: 2 }}>
          Only on some nodes by their scheduling rules:{' '}
          {summary.partial.map((p, i) => (
            <React.Fragment key={`${p.ds.namespace}/${p.ds.name}`}>
              {i > 0 && ', '}
              <Link routeName="DaemonSet" params={{ namespace: p.ds.namespace, name: p.ds.name }}>
                {p.ds.name}
              </Link>{' '}
              ({p.text.toLowerCase()})
            </React.Fragment>
          ))}
        </Typography>
      )}
    </Box>
  );
}

/** Pods per node for one node pool. Layout: docs/layout.md option C, v1.1 grouping by pod kind. */
export function NodeView() {
  const vm = useNodeViewModel();
  // A single node has room to list its agents; larger pools start collapsed. One toggle for all
  // columns, so each agent keeps the same row in every column.
  const [agentsToggled, setAgentsToggled] = useState<boolean | undefined>(undefined);
  const agentsExpanded = agentsToggled ?? vm.nodes.length === 1;

  const workloadNodes = useMemo(() => workloadNodeCounts(vm.nodes), [vm.nodes]);
  const workloadColors = useMemo(
    () => assignWorkloadColors([...workloadNodes].filter(([, n]) => n > 1).map(([k]) => k)),
    [workloadNodes]
  );
  const statusOf = (p: PodView) => vm.podStatus.get(podKey(p))?.status ?? '';
  const poolAgents: PoolAgentSummary = vm.daemonSets
    ? summarizePoolAgents(vm.daemonSets, vm.nodes, statusOf)
    : {
        text:
          vm.lists.pods.status === 'failed'
            ? 'Node agents unknown: pods could not be listed.'
            : 'Node agent coverage unknown: DaemonSets could not be listed.',
        status: '',
        gaps: [],
        partial: [],
      };
  const problems = useMemo(() => describeListProblems(vm.lists), [vm.lists]);

  if (vm.loading) {
    return <Loader title="Loading nodes and pods" />;
  }

  const counts = vm.nodes.reduce(
    (acc, n) => {
      const g = groupNodePods(n);
      return {
        user: acc.user + g.user.length,
        system: acc.system + g.system.length,
        agents: acc.agents + g.agents.length,
      };
    },
    { user: 0, system: 0, agents: 0 }
  );
  const total = counts.user + counts.system + counts.agents;
  const podsKnown = vm.lists.pods.status !== 'failed';
  const nodesFailed = vm.lists.nodes.status === 'failed';
  const subtitle = nodesFailed
    ? 'Nodes unknown'
    : !podsKnown
    ? `${plural(vm.nodes.length, 'node')}, pods unknown`
    : `${plural(vm.nodes.length, 'node')}, ${plural(total, 'pod')}: ${counts.user} user, ${
        counts.system
      } system, ${plural(counts.agents, 'node agent')}${
        podsMayBeIncomplete(vm.lists) ? ' (may be incomplete)' : ''
      }`;
  const unknownPool = vm.requestedPoolId && vm.requestedPoolId !== vm.selectedPoolId;

  const poolSelector = (
    <TextField
      key="pool"
      select
      size="small"
      label="Node pool"
      value={vm.selectedPoolId ?? ''}
      onChange={e => vm.setPool(e.target.value)}
      disabled={vm.pools.length === 0}
      sx={{ minWidth: 300 }}
    >
      {vm.pools.map(p => (
        <MenuItem key={p.id} value={p.id}>
          {poolLabel(p, vm.defaultPoolId)}
        </MenuItem>
      ))}
    </TextField>
  );

  return (
    <SectionBox title="Node view" subtitle={subtitle} headerProps={{ actions: [poolSelector] }}>
      {problems.map(p => (
        <ListProblemAlert key={p.key} problem={p} />
      ))}
      {unknownPool && !nodesFailed && (
        <Alert severity="info" sx={{ mb: 1 }}>
          Node pool {vm.requestedPoolId} was not found. Showing {vm.selectedPoolId ?? 'no pool'}{' '}
          instead.
        </Alert>
      )}
      {nodesFailed ? null : vm.nodes.length === 0 ? (
        <Typography color="text.secondary" sx={{ py: 2 }}>
          {vm.pools.length === 0
            ? 'No nodes found. Check that your account can list nodes in this cluster.'
            : 'This node pool has no nodes.'}
        </Typography>
      ) : (
        <>
          <PoolAgentLine summary={poolAgents} />
          <Typography variant="caption" component="p" color="text.secondary" sx={{ mb: 1 }}>
            Node agents are DaemonSet pods, one per node. Other pods are listed by workload; a
            colored edge marks a workload that runs on more than one node, in the same color on
            each. Requests are shown as CPU · memory.
          </Typography>
          <Box
            sx={{
              display: 'grid',
              gap: `${GRID_GAP_PX}px`,
              gridTemplateColumns: gridColumns(vm.nodes.length),
              alignItems: 'stretch',
              // Headlamp's PercentageBar sets z-index: theme.zIndex.drawer on a positioned
              // recharts wrapper; contain it so it cannot paint over the details drawer.
              isolation: 'isolate',
            }}
          >
            {vm.nodes.map(n => (
              <NodeColumn
                key={n.name}
                node={n}
                podStatus={vm.podStatus}
                daemonSets={vm.daemonSets}
                workloadNodes={workloadNodes}
                workloadColors={workloadColors}
                agentsExpanded={agentsExpanded}
                onToggleAgents={() => setAgentsToggled(!agentsExpanded)}
              />
            ))}
          </Box>
        </>
      )}
    </SectionBox>
  );
}
