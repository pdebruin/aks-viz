# aks-node-viz

Headlamp plugin for AKS Desktop that shows pods per node for one node pool. Design: ../docs/layout.md. Requirements: ../docs/requirements.md.

Status: v1 view at sidebar entry "Node view" (route `/c/<cluster>/aks-node-viz?pool=<pool id>`, for example `?pool=nap%2Fdefault`). One column per node in the selected pool. Pods are grouped by kind: node agents (DaemonSet pods, collapsed to one status line), then user and system pods as named one-line rows. A pool-level line summarizes node agent coverage.

## Build and test

Node 22 or later (tested on Node 24.16.0, npm 12.0.1).

```
npm ci
npm run build      # dist/main.js
npm test           # vitest: pure data functions (src/data), presentation helpers and a render smoke test (src/components)
npm run tsc
npm run lint
```

## Install into AKS Desktop (Linux, development mode)

```
npm run install:aks-desktop
```

This builds and copies `dist/main.js` and `package.json` to `~/.config/AKS-Desktop/plugins/aks-node-viz/` (or `~/.local/share/AKS-Desktop/plugins/` if `~/.local/share/AKS-Desktop` exists). Set `AKS_DESKTOP_PLUGINS_DIR` to override, and `SKIP_BUILD=1` to copy without building.

AKS Desktop reads this directory only with Plugin Development Mode on (Settings > Plugins). `npm start` does not work for AKS Desktop: it copies into `~/.config/Headlamp/plugins`, which AKS Desktop does not read.

After installing, restart AKS Desktop or reload its window, then check that the plugin is enabled in Settings > Plugins.

## View (src/components)

- `NodeView`: page. Pool selector (stored in the `pool` URL query parameter), counts per pod kind, a pool-level node agent line (gaps and DaemonSets that only target some nodes, counts scoped to the pool), and the node grid (a third of the row for pools of up to 3 nodes, a quarter for larger pools, at least 340px, wraps). One agent list toggle for all columns; open by default for a single node.
- `NodeColumn`: node header (link to node details, pool and mode, Ready/NotReady/Cordoned, CPU and memory requests vs allocatable), then three groups with summed requests: node agents (status line; problems and gaps always listed; full list in the same order on every node, with rows for gaps and "Not scheduled here"), user pods, system pods. The pod area scrolls after about 18 rows.
- `PodItems`: `WorkloadRow` (status dot, workload name linking to the pod, namespace unless the group shares one, reason when not running, requests; a colored left edge for workloads on more than one node) and `AgentRowItem`.
- `useNodeViewModel`: composes `useClusterResources` and `buildNodePoolView` with the URL pool parameter, and derives pod status (Headlamp Pods list mapping) from the same watched pod list.
- `presentation.ts`: pure, unit-tested formatting, status mapping, workload names (ReplicaSet hash stripped), workload identity colors, grouping by pod kind, agent rows and summaries, pluralization and pool labels.

## Data layer (src/data)

- `useNodePoolView(poolId?)`: one hook that returns pools, default pool, nodes of the selected pool with allocatable, requested and unallocated CPU and memory, system and user pods per node, and DaemonSet coverage for that pool.
- `useClusterResources()`: watch-based Node, Pod and DaemonSet lists (Headlamp `useList`, no polling). RBAC needed: list and watch on nodes, pods and daemonsets, cluster-wide.
- Pure functions (no Headlamp import, unit tested): `parseQuantity`, `podEffectiveRequests`, `classifyPod`, `nodePoolOf`, `listNodePools`, `selectDefaultPool`, `daemonSetShouldRunOnNode`, `daemonSetCoverage`, `buildNodePoolView`.

Rules are documented in the source comments and in ../.squad/decisions.
