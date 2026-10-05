import { LightTooltip, Link } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Box from '@mui/material/Box';
import { Theme, useTheme } from '@mui/material/styles';
import React from 'react';
import type { PodView } from '../data';
import {
  AgentRow,
  formatPodRequests,
  formatPodRequestsShort,
  PodUiStatus,
  UiStatus,
  workloadName,
} from './presentation';

/** Palette color for a status, the same keys Headlamp's StatusLabel uses; '' is grey. */
export function statusColor(theme: Theme, status: UiStatus): string {
  return status ? theme.palette[status].main : theme.palette.grey[500];
}

const UNKNOWN: PodUiStatus = { status: '', reason: 'Unknown', restarts: 0 };
const ROW_HEIGHT = 26;
const TOOLTIP_DELAY_MS = 400;

function PodDetails(props: { pod: PodView; st: PodUiStatus; nodesWithWorkload?: number }) {
  const { pod, st, nodesWithWorkload } = props;
  const owner = pod.ownerKind ? `${pod.ownerKind} ${pod.ownerName ?? ''}` : 'none';
  return (
    <Box sx={{ fontSize: '0.8rem', lineHeight: 1.5 }}>
      <Box sx={{ fontWeight: 600, wordBreak: 'break-all' }}>{pod.name}</Box>
      <Box>Namespace: {pod.namespace}</Box>
      <Box>Status: {st.reason}</Box>
      {st.restarts > 0 && <Box>Restarts: {st.restarts}</Box>}
      <Box>Requests: {formatPodRequests(pod.requests)}</Box>
      <Box>Owner: {owner}</Box>
      {nodesWithWorkload !== undefined && nodesWithWorkload > 1 && (
        <Box>Runs on {nodesWithWorkload} nodes in this pool</Box>
      )}
    </Box>
  );
}

export function StatusDot({ status }: { status: UiStatus }) {
  const theme = useTheme();
  return (
    <Box
      component="span"
      aria-hidden
      sx={{
        flex: '0 0 auto',
        width: 8,
        height: 8,
        borderRadius: '50%',
        bgcolor: statusColor(theme, status),
      }}
    />
  );
}

const ellipsis = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

/** Status reason shown in the row when the pod is not simply Running or Succeeded. */
function ReasonText({ st }: { st: PodUiStatus }) {
  const theme = useTheme();
  if (st.reason === 'Running' || st.reason === 'Succeeded') return null;
  return (
    <Box
      component="span"
      sx={{
        ...ellipsis,
        flex: '0 1 auto',
        fontSize: '0.75rem',
        color: st.status ? statusColor(theme, st.status) : 'text.secondary',
        fontWeight: 500,
      }}
    >
      {st.reason}
    </Box>
  );
}

function Requests({ pod }: { pod: PodView }) {
  return (
    <Box
      component="span"
      sx={{
        flex: '0 0 auto',
        ml: 'auto',
        pl: 1,
        fontSize: '0.75rem',
        color: 'text.secondary',
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {formatPodRequestsShort(pod.requests)}
    </Box>
  );
}

/**
 * One pod of a Deployment, StatefulSet, Job or bare pod, on one line:
 * identity rail, status dot, workload name (link to the pod), instance, namespace, reason, requests.
 * The rail color is the workload's identity color when it runs on more than one node, else a neutral divider.
 */
export function WorkloadRow(props: {
  pod: PodView;
  st?: PodUiStatus;
  identityColor?: string;
  showInstance: boolean;
  /** False when the group header already names the one namespace of all rows. */
  showNamespace: boolean;
  nodesWithWorkload: number;
}) {
  const {
    pod,
    st = UNKNOWN,
    identityColor,
    showInstance,
    showNamespace,
    nodesWithWorkload,
  } = props;
  const theme = useTheme();
  const wl = workloadName(pod);
  return (
    <LightTooltip
      title={<PodDetails pod={pod} st={st} nodesWithWorkload={nodesWithWorkload} />}
      placement="right"
      enterDelay={TOOLTIP_DELAY_MS}
      enterNextDelay={TOOLTIP_DELAY_MS}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          minHeight: ROW_HEIGHT,
          pl: 1,
          pr: 1.5,
          borderLeft: `4px solid ${identityColor ?? theme.palette.divider}`,
          opacity: pod.phase === 'Succeeded' || pod.terminating ? 0.6 : 1,
          '&:hover': { bgcolor: 'action.hover' },
        }}
      >
        <StatusDot status={st.status} />
        <Box sx={{ ...ellipsis, flex: '0 1 auto', fontSize: '0.875rem' }}>
          <Link
            routeName="Pod"
            params={{ namespace: pod.namespace, name: pod.name }}
            aria-label={`${pod.namespace}/${pod.name}: ${st.reason}`}
          >
            {wl.name}
          </Link>
        </Box>
        {showInstance && wl.instance && (
          <Box
            component="span"
            sx={{ flex: '0 0 auto', fontSize: '0.75rem', color: 'text.secondary' }}
          >
            {wl.instance}
          </Box>
        )}
        {showNamespace && (
          <Box
            component="span"
            sx={{ ...ellipsis, flex: '0 2 auto', fontSize: '0.75rem', color: 'text.secondary' }}
          >
            {pod.namespace}
          </Box>
        )}
        <ReasonText st={st} />
        <Requests pod={pod} />
      </Box>
    </LightTooltip>
  );
}

/** One node agent: a DaemonSet pod, or a placeholder when the DaemonSet has no pod on this node. */
export function AgentRowItem(props: { row: AgentRow; st?: PodUiStatus }) {
  const { row } = props;
  const theme = useTheme();
  const base = {
    display: 'flex',
    alignItems: 'center',
    gap: 0.75,
    minHeight: ROW_HEIGHT - 4,
    pl: 1,
    pr: 1.5,
    borderLeft: '4px solid transparent',
    fontSize: '0.8125rem',
  };

  if (row.kind !== 'pod') {
    const missing = row.kind === 'missing';
    return (
      <Box sx={{ ...base, color: missing ? 'text.primary' : 'text.disabled' }}>
        <StatusDot status={missing ? 'warning' : ''} />
        <Box component="span" sx={{ ...ellipsis, flex: '0 1 auto' }}>
          <Link routeName="DaemonSet" params={{ namespace: row.namespace, name: row.dsName }}>
            {row.dsName}
          </Link>
        </Box>
        <Box
          component="span"
          sx={{
            ml: 'auto',
            pl: 1,
            fontSize: '0.75rem',
            whiteSpace: 'nowrap',
            color: missing ? theme.palette.warning.main : 'text.disabled',
            fontWeight: missing ? 500 : 400,
          }}
        >
          {missing ? 'Missing: no pod on this node' : 'Not scheduled here'}
        </Box>
      </Box>
    );
  }

  const st = props.st ?? UNKNOWN;
  return (
    <LightTooltip
      title={<PodDetails pod={row.pod} st={st} />}
      placement="right"
      enterDelay={TOOLTIP_DELAY_MS}
      enterNextDelay={TOOLTIP_DELAY_MS}
    >
      <Box
        sx={{
          ...base,
          '&:hover': { bgcolor: 'action.hover' },
          opacity: row.pod.terminating ? 0.6 : 1,
        }}
      >
        <StatusDot status={st.status} />
        <Box component="span" sx={{ ...ellipsis, flex: '0 1 auto' }}>
          <Link
            routeName="Pod"
            params={{ namespace: row.pod.namespace, name: row.pod.name }}
            aria-label={`${row.pod.namespace}/${row.pod.name}: ${st.reason}`}
          >
            {row.dsName}
          </Link>
        </Box>
        <ReasonText st={st} />
        <Requests pod={row.pod} />
      </Box>
    </LightTooltip>
  );
}
