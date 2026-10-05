# aks-viz requirements draft, derived from docker-swarm-visualizer

Status: draft for review. Author: Lead. Date: 2026-10-05.

## Source and scope

- Repo: github.com/dockersamples/docker-swarm-visualizer, branch master, not archived, last push 2024-10-26 (GitHub API).
- Read: README.md, server.js, Dockerfile, docker-compose.yml, healthcheck.js, index.tpl, src/main.js, src/data-provider.js, src/utils/request.js, src/utils/filter-containers.js, src/vis-physical/index.js, src/vis-physical/styles.less, src/main.less, src/styles/variables.less, src/vis-logical/index.js (head), src/stack-header/index.js. Open issue titles only.
- No code copied.

## Corrections to the task brief

These change what we should build, so they come first.

- Node "free resources" is not what the visualizer shows. It shows total node memory (Description.Resources.MemoryBytes). src/utils/request.js labels it "G free", src/data-provider.js (updateNodes) relabels it "G RAM" on the next poll. No CPU is shown. Free/allocatable resources is a new requirement for us, not a parity item.
- There are no HOST, PORT or node/service filter env vars. Port is hardcoded to 8080 (server.js). Config env vars are MS, CTX_ROOT, DOCKER_HOST, DOCKER_TLS_VERIFY, DOCKER_CERT_PATH (server.js, Dockerfile, README "Running on Windows").
- The live update is polling, not push. server.js creates a WebSocket server but attaches no handlers; src/main.js polls with setTimeout every MS ms.
- The physical view is the only view. src/vis-logical (force-directed service link graph) and src/stack-header (Tutum stack switcher) exist in the tree but are not imported by src/main.js. They are dead code from the 2015 Tutum version.
- The node status dot is binary: green for ready, red for anything else (src/utils/request.js filterStoppedNodes, styles.less .status). Task status dot is also binary: green for running, red for any other state (styles.less .statuscont / .statuscontrun).

## 1. Capability table

Priority key: Must = needed for parity with the core swarm view; Should = parity item with lower value or K8s-adapted; Could = nice to have; Drop = not applicable or replaced by Headlamp/AKS Desktop.

| # | Capability | Where found | Kubernetes/AKS equivalent | Proposed requirement |
|---|---|---|---|---|
| 1 | One column per node, all nodes side by side | README intro; src/vis-physical/index.js render; styles.less .node, .node-cluster-content | One column per Node in the current cluster | Must: render one column per node |
| 2 | Nodes sorted by hostname | src/utils/request.js filterStoppedNodes | Sort by node name | Must: default sort by node name. Could: sort by node pool then name |
| 3 | Node header shows hostname | src/data-provider.js updateNodes | metadata.name | Must |
| 4 | Node header shows role (manager/worker) | src/data-provider.js updateNodes (Spec.Role) | Control plane vs agent; on AKS, node pool name and mode (System/User) | Must: node header shows pool name and mode, from the labels in row 43. unsourced reasoning: AKS control plane nodes are not visible as Node objects, so "role" maps to pool mode, not to control plane |
| 5 | Node header shows total memory in GB | src/data-provider.js updateNodes; src/utils/request.js | status.capacity / status.allocatable memory | Must: show allocatable CPU and memory, and unallocated = allocatable minus sum of pod requests on that node. Phase 2: actual usage from metrics-server, and limits/overcommit. This exceeds parity (see corrections). Basis: the scheduler keeps the sum of requests below node capacity, and usage may exceed the request (kubernetes.io "Resource Management for Pods and Containers", sections "How Pods with resource requests are scheduled" and "Requests and limits") |
| 6 | Node header shows platform arch/OS | src/data-provider.js updateNodes (Description.Platform) | status.nodeInfo architecture and operatingSystem | Should |
| 7 | Node header shows all node labels as key=value | src/data-provider.js updateNodes (Spec.Labels); main.less .labelarea | Node labels | Could: show a curated subset (pool, zone, VM size) with full labels on demand. unsourced reasoning: AKS nodes carry many system labels, so showing all would swamp the header |
| 8 | Node status dot: green ready, red down | src/utils/request.js filterStoppedNodes; styles.less .status data-state ready/down | Node Ready condition | Must: green Ready, red NotReady/Unknown. Should: distinct marker for cordoned (unschedulable) nodes |
| 9 | Node that disappears from API stays visible, marked down, tasks removed | README intro; src/data-provider.js updateNodes (missing nodes set to 'down') | Node deleted vs NotReady | Should: keep NotReady nodes visible. unsourced reasoning: a deleted Node object (scale-down) should disappear, not linger as red, otherwise autoscaler activity looks like outages |
| 10 | Node header text truncated with ellipsis, expands on hover | styles.less .node-meta, .node-meta:hover | Same | Should: truncate long node names, reveal full text on hover or tooltip |
| 11 | One card per task stacked inside its node column | src/data-provider.js addContainer; src/vis-physical/index.js | One card per Pod, grouped by spec.nodeName | Must |
| 12 | Only tasks with desired state "running" are shown | src/utils/request.js filterStoppedTasks | Exclude Succeeded/terminated pods by default | Must: hide completed pods by default. Should: toggle to show Succeeded/Failed pods |
| 13 | Card shows service name (bold title) | src/data-provider.js addContainer (ServiceName) | Pod name, plus owning workload name | Must: pod name as title, owner workload as secondary line |
| 14 | Card shows image name and tag, tag defaults to "latest" | src/data-provider.js addContainer (image regex) | Container image(s); pod may have several containers | Must: show image:tag per container. Should: collapse to first container plus count when many |
| 15 | Card shows command (container args) only if set | src/data-provider.js addContainer (Spec.ContainerSpec.Args) | container command/args | Could: show on hover or expanded card. unsourced reasoning: command adds card height for little value in K8s, where most pods use the image default |
| 16 | Card shows "updated" timestamp (d/m H:MM) | src/data-provider.js addContainer (UpdatedAt) | Pod start time or last condition transition | Must: show age or last-transition time. Format choice open |
| 17 | Card shows container ID (or "null") | src/data-provider.js addContainer (ContainerStatus.ContainerID) | Pod UID or containerStatuses[].containerID | Could: show on hover only |
| 18 | Card shows task state text | src/data-provider.js addContainer (Status.State) | Pod phase plus container reason (e.g. CrashLoopBackOff) | Must: show phase and, when not Running, the waiting/terminated reason |
| 19 | Card status dot: green running, red anything else | styles.less .statuscont, .statuscontrun | Pod readiness | Must: replace binary dot with at least green Running+Ready, amber Pending/not ready, red Failed/CrashLoop. unsourced reasoning: binary red hides the difference between starting and broken, which is the main K8s debugging question (cf. open issue #107 "Unable to display content while containers are preparing") |
| 20 | Card border color derived from a hash of the service ID, so all replicas of a service share a color | src/data-provider.js stringToColor, addContainer | Color per owning workload | Must: stable color per workload, consistent across nodes and refreshes |
| 21 | Fixed-width cards (200px), text ellipsis, flex-wrap inside node | styles.less .container, .node-content | Same | Must: fixed-width cards that wrap inside a column, and compact cards. A real AKS node had 12 pods, 11 in kube-system and 1 user pod (user screenshot of Headlamp Pods view) |
| 22 | Layout optimized for 3 nodes on a big screen; horizontal overflow hidden | README TODO; main.less (overflow-x hidden) | Large AKS clusters, tens to hundreds of nodes | Must: default 3-5 node columns per row; extra nodes wrap to new rows; vertical scroll. No hidden horizontal overflow |
| 23 | Text filter box, space-separated terms, OR match against card title | src/utils/filter-containers.js filterContainers | Filter by pod/workload name | Must: text filter. Should: also namespace filter (see gaps) |
| 24 | Filter persisted in URL as ?filter=, debounced 500 ms, restored on load | src/utils/filter-containers.js filterHistory, filterOnLoad | Same, in Headlamp route | Should: filter state in the URL so a view can be shared |
| 25 | Tab button toggles visibility of the filter box | src/main.js tab-physical click handlers; index.tpl | Toolbar control | Drop: use a normal always-visible toolbar |
| 26 | Show/hide animation (0.5 s) when cards are filtered | styles.less @keyframes hide/show | Same | Could |
| 27 | Polling refresh every MS ms (server default 5000, image default 1000) | server.js; Dockerfile ENV; src/main.js reload | Kubernetes watch | Must: live updates without manual refresh. Mechanism (watch vs poll) to be decided against Headlamp APIs. Should: user-visible refresh/pause control |
| 28 | Each poll clears and rebuilds all cards per node; removed services/tasks disappear on next poll | src/data-provider.js updateContainers; README intro | Pod deleted events | Must: pods disappear when deleted; Should: avoid full re-render flicker |
| 29 | Tolerates incomplete API data (missing node name fills in on next poll) | README intro; src/data-provider.js updateNodes (name length check) | Partial or failed list/watch | Should: render partial data and show a stale/error indicator instead of blanking |
| 30 | Raw task/container JSON link on manager nodes; click handler commented out | src/data-provider.js addContainer (link); src/vis-physical/index.js (commented click) | Headlamp pod details page | Must: click card opens the Headlamp pod details view. Replaces the disabled raw-JSON feature |
| 31 | No hover tooltip on cards (mouseenter/mouseleave set to null) | src/vis-physical/index.js render | Same | Could: hover tooltip with extra fields (rows 15, 17) |
| 32 | Server proxies any GET under /apis/* to the Docker Engine API | server.js app.get(ctxRoot + 'apis/*') | Headlamp backend talks to the API server with the user's kubeconfig | Drop: plugin must use Headlamp's existing cluster access, no own proxy |
| 33 | No authentication; README warns it is insecure and must not run in production | README note; server.js | User's kubeconfig identity and Kubernetes RBAC | Must: read-only, runs under the user's own credentials, degrades gracefully when RBAC denies listing nodes or pods cluster-wide |
| 34 | Must run on a manager node with the Docker socket mounted | README "To run in a docker swarm" (constraint node.role==manager) | Nothing deployed in cluster | Drop: plugin runs client-side in AKS Desktop |
| 35 | Remote engine via DOCKER_HOST, TLS via DOCKER_TLS_VERIFY / DOCKER_CERT_PATH | server.js; README "Running on Windows" | Kubeconfig context | Drop: covered by AKS Desktop cluster selection |
| 36 | Context root via CTX_ROOT for running behind a load balancer | README; server.js | Plugin route path | Drop: Headlamp owns routing. Plugin registers its own route (Headlamp docs, Plugin Functionality: Route, registerRoute) |
| 37 | Fixed port 8080, HTTP healthcheck | server.js; healthcheck.js; Dockerfile HEALTHCHECK | None | Drop |
| 38 | Multi-arch images (amd64, ARM, Windows nanoserver) | README "Supported architectures", "Running on ARM", "Running on Windows" | AKS Desktop platforms | Drop as a requirement on us; inherited from AKS Desktop packaging. Should: Windows nodes render correctly (row 6) |
| 39 | Single implicit cluster grouping ("clusterid") wrapping all nodes | src/data-provider.js physicalStructProvider (nodeClusters) | One cluster per view | Must: one cluster at a time, following the selected AKS Desktop cluster |
| 40 | Dark theme, fixed colors (#254356 background, green #00FF00 / red #FF0000 dots) | index.tpl body style; src/styles/variables.less | Headlamp theme | Must: follow the Headlamp light/dark theme (Headlamp docs, Plugin Functionality: App Theme). Do not hardcode the original palette. Should: status not conveyed by color alone (accessibility) |
| 41 | Logical view: force-directed graph of linked services | src/vis-logical/index.js (not imported by src/main.js) | Service-to-workload graph | Drop: dead code in the original, out of scope. Headlamp map view, if relevant, is a separate question |
| 42 | Stack switcher header (Tutum stacks) | src/stack-header/index.js (not imported) | Namespace or app grouping | Drop as parity item. Namespace filter covered in gaps |
| 43 | Node pool selector | None; AKS addition | Node pools, from node labels karpenter.sh/nodepool (NAP/Karpenter) and kubernetes.azure.com/agentpool (classic agent pools); mode from kubernetes.azure.com/mode | Must: node pool selector listing pools from those two labels. Default pool: the NAP NodePool named `default` if present, else the first System-mode agent pool by name. Compare mode values case-insensitively. Default scope: all namespaces, including kube-system, for the selected pool. Sources: Microsoft Learn "Troubleshoot agent pool issues in AKS", section "Inspect the Kubernetes nodes" (agentpool label); "Use labels in an AKS cluster", section "Unavailable labels" (mode label, values User or system); "Configure node pools for node auto-provisioning (NAP) in AKS", section "Review default node pool configuration" (NodePool named default, plus system-surge); same page, section "Disable NAP" (karpenter.sh/nodepool identifies NAP nodes). Contradiction: the EKS-to-AKS node pools page lists mode values `User` or `System`, the labels page lists `User` or `system` |

Counts: 43 capabilities. Must 24, Should 5, Could 5, Drop 9 (rows with a mixed Must/Should split are counted by their first priority).

## 2. Known gaps in the original (from open issue titles only, not investigated)

- #58 "Feature: Highlight drain nodes": node availability (drain/pause) is not shown. Maps to cordoned nodes, row 8.
- #107 "Unable to display content while containers are preparing": supports a pending/starting state, row 19.
- #110 "Visualizer displays wrong info if previous tasks failed": supports showing restart/failure history, gap list below.

## 3. Requirement gaps K8s/AKS adds that the swarm visualizer never had

All items below are unsourced reasoning unless marked otherwise.

- unsourced reasoning: Pending/unscheduled pods have no node. Need an "Unscheduled" column or banner with the scheduling reason, otherwise the most important failure mode is invisible.
- Namespaces: default shows all namespaces, including kube-system (row 43). Namespace filter is a Should (row 23).
- Node pools: covered by the node pool selector (row 43); System vs User mode replaces manager/worker (row 4).
- unsourced reasoning: DaemonSet pods appear on every node and dominate the view. Default shows all pods, including DaemonSet pods (row 43). Need a toggle to hide or collapse DaemonSet-owned pods.
- unsourced reasoning: Multi-container pods, init containers and sidecars. Card needs a per-container state summary, not one state.
- unsourced reasoning: Restart count and last termination reason (covers swarm issue #110).
- unsourced reasoning: Resource requests per pod, so "unallocated" on the node header is explainable.
- unsourced reasoning: Scale. AKS clusters can have hundreds of nodes and thousands of pods; need virtualization or paging and a watch strategy that does not refetch everything every second.
- unsourced reasoning: RBAC-limited users who can list pods in one namespace but not list nodes cluster-wide.
- unsourced reasoning: Multi-cluster. AKS Desktop can hold several clusters (Headlamp docs list a Cluster Chooser extension point under Plugin Functionality). Proposal: one cluster per view, no merged multi-cluster view in v1.
- unsourced reasoning: Virtual nodes (ACI) and Windows node pools render as normal columns but with different capacity semantics.

## 4. Headlamp facts used

Verified from headlamp-k8s/headlamp docs/development/plugins/functionality/index.md (section headings only): Route (registerRoute), Sidebar Item (registerSidebarEntry), Details View Section, Cluster Chooser, Plugin Settings, App Theme. Nothing else about Headlamp APIs (watch hooks, resource classes) is verified here.
