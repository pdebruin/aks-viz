# aks-node-viz

Headlamp plugin for AKS Desktop that shows pods per node for one node pool. Requirements and their status: ../docs/requirements.md.

Status: v1 view at sidebar entry "Node view" (route `/c/<cluster>/aks-node-viz?pool=<pool id>`, for example `?pool=nap%2Fdefault`). One column per node in the selected pool. Pods are grouped by kind: node agents (DaemonSet pods, collapsed to one status line), then user and system pods as one-line rows.

## Build and test

Node 22 or later (tested on Node 24.16.0, npm 12.0.1).

```
npm ci
npm run build      # dist/main.js
CI=true npm test   # vitest: pure logic (src/model.test.ts) and a render test (src/NodeView.test.tsx)
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

## Source

- `src/index.tsx`: sidebar entry and route.
- `src/NodeView.tsx`: the page. Watch-based Node and Pod lists (Headlamp `useList`, no polling) pinned to the page's cluster (`K8s.useCluster()`), so lists from other selected clusters are never merged. Pool selector (stored in the `pool` URL query parameter), node grid (a third of the row for up to 3 nodes, a quarter for larger pools, at least 340px, wraps), and per node: Ready/NotReady/Cordoned, CPU and memory request bars vs allocatable, then node agents (collapsed to a status line, not-ready agents always listed; one toggle for all columns, open by default for a single node), user pods and system pods with summed requests. A colored left edge marks a workload on more than one node.
- `src/model.ts`: pure logic, no Headlamp import. Quantity parsing, pod effective requests (init containers, sidecars, pod-level requests, overhead; Succeeded and Failed pods excluded), pool grouping (`karpenter.sh/nodepool` before `kubernetes.azure.com/agentpool`; default pool rule), pod status (Failed and container errors such as CrashLoopBackOff, ImagePullBackOff or Error are red; Running not Ready is amber; Pending is grey), workload names and colors.

## Errors and RBAC

RBAC needed: list and watch on nodes (cluster-scoped) and on pods in all namespaces. When a list fails (for example HTTP 403), the page shows an error alert naming the kind, the HTTP status, the namespaces if any, and the RBAC verb and resource needed. A list with any error is treated as unknown: if pods fail, nodes are still shown but pod rows and request bars are not. Headlamp's own query retries apply; otherwise reload the page after access is fixed.
