# Scale layout options: pods per node at 10-50+ pods

Author: Frontend. Date: 2026-10-05. Status: proposal for review.

## Recommendation

Use option C, split column: user pods as one-line rows on top, system pods as a compact tile strip at the bottom, with a fixed maximum column height and per-column scroll for the row area. Add a density switch (Rows / Tiles) later as a Should, reusing option B as the Tiles mode.

Why C:

- It matches the observed shape of a real node: 11 of 12 pods were kube-system, mostly per-node agents, and 1 was a user pod (requirements.md, scale fact). The pods the user came to see get the readable space; the agents stay visible but cost little height.
- unsourced reasoning: per-node agents are mostly DaemonSet pods, so the system strip has nearly the same members on every node. With a stable sort order, the strips line up across columns and a single red tile on one node stands out when scanning a row of 5 nodes.
- Row height is bounded to roughly 470px regardless of pod count, so reaching node 6 means scrolling past one row, not 60 pod cards.

Main tradeoff: system pods lose their name on the card (name is on hover and in the column's expand view). If users regularly debug kube-system pods by name, A is safer.

## Shared assumptions

These apply to all three options. All numbers are unsourced reasoning, to be checked against AKS Desktop window sizes.

- Grid: CSS grid, 3-5 columns depending on available width, min column width about 260px, wrap to new rows, vertical page scroll only. No horizontal overflow. See "Width check against AKS Desktop" for the numbers.
- Columns in one grid row share the same height (grid stretch) so rows read as a band.
- Node header (all options, about 96px):

```
+----------------------------------+
| o aks-nodepool1-123-vmss000002   |   o = ready dot
| nodepool1 . System . 12 pods     |
| CPU  [#######-----] 1.2/1.9 free |   PercentageBar: requests vs allocatable
| Mem  [#####-------] 3.1/5.6 free |   "free" = allocatable minus requests
+----------------------------------+
```

- Sort order inside a column: problem pods first (error, warning, pending), then by namespace, then by name. unsourced reasoning: problems first matters more than alphabetical once a column scrolls.
- System pod definition (open question for Lead/Kube): namespace kube-system, or owner kind DaemonSet. The draft only names kube-system.
- Click on any pod opens the Headlamp pod details view. Hover shows the full card.

## Width check against AKS Desktop

Source: user-provided screenshot of the AKS Desktop home screen (no cluster connected), described in session. Not independently verified.

- Window about 1850px wide, left sidebar about 240px, so the content area is about 1550px.
- At the swarm card width of 200px plus 16px gaps, 7 columns fit (7 x 200 + 6 x 16 = 1496px).
- unsourced reasoning: 200px is too narrow for option A and C rows, which put pod name, namespace and age on one line. AKS pod names such as azure-cns-xxxxx or ama-logs-rs-xxxxxxxxxx-xxxxx already use most of 200px at body font size. Minus about 48px page padding, 5 columns give about 285px each (5 x 285 + 4 x 16 = 1489px), which fits name plus namespace plus age.
- Breakpoints: 5 columns at 1550px content width, 4 at about 1200px, 3 at about 900px (smaller windows or sidebar expanded with a details panel open). Below about 900px, 2 columns. Each step keeps columns at or above 260px.
- Option B tiles would allow 6-7 columns at 200px. Not recommended as default: it breaks the 3-5 decision and gains one node per row at the cost of all names.
- Conclusion: the 3-5 default holds; 5 is the right default for this window size, not 6-7.

## Visual style

Match AKS Desktop and Headlamp, not the dark swarm visualizer. Observed in the same screenshot: light theme, dark navy top bar, Headlamp tables with blue link text, sortable headers, kebab menus; green status chips as in the Headlamp Pods table.

- Light mode by default, following the active Headlamp theme (theme.palette) so dark mode works if the user switches. No custom background colors.
- Node columns render as light surface panels with a thin divider, like Headlamp SectionBox, not dark cards.
- Pod names and node names are blue links (Headlamp Link) to the Headlamp details view, same as names in the Pods table.
- State text uses StatusLabel chips (green success, as in the Pods table). Dots and tiles use the same palette keys so dot color and chip color always agree.
- System pods: muted text (palette.text.secondary) and lighter tiles, not a different hue, so status color stays the only colored signal.
- unsourced reasoning: if node actions (open node, cordon) are ever added, put them in a kebab menu on the node header to match table row actions. Whether actions are in scope is not decided in this doc.

## Status color semantics

Follow Headlamp's own pod status mapping so the plugin agrees with the Pods list. Verified in headlamp source, frontend/src/components/pod/List.tsx, function getPodStatus:

| Pod state | Headlamp status | Color |
|---|---|---|
| phase Running and Ready condition True, or phase Succeeded | success | theme.palette.success |
| phase Running, Ready not True | warning | theme.palette.warning |
| phase Failed | error | theme.palette.error |
| anything else (Pending, Unknown) | '' | grey |

Notes:

- Verified: StatusLabel (frontend/src/components/common/Label.tsx) takes status 'success' | 'warning' | 'error' | '' and derives colors from theme.palette, falling back to grey. Using it, or the same palette keys for dots, keeps light/dark theme and any AKS Desktop theme consistent.
- Verified: getPodStatus is not exported; makePodStatusLabel is exported from pod/List.tsx. Not verified whether the plugin library re-exports makePodStatusLabel. If not, we copy the 15-line mapping.
- unsourced reasoning: CrashLoopBackOff pods are phase Running, not Ready, so they show warning, not error. Swarm-visualizer users may expect red. Proposal: keep Headlamp's mapping for consistency and show the container reason (CrashLoopBackOff, ImagePullBackOff) as text on the card.
- unsourced reasoning: Succeeded pods (completed Jobs) should render dimmed so they do not read as healthy running workload.
- Accessibility (unsourced reasoning): color is never the only signal. Error tiles get a filled marker plus the reason text on hover; warning gets an outline. Dot plus text label in rows.
- Node ready dot uses the same palette: Ready True success, Ready False error, Unknown grey.

## Option A: bounded compact rows

Every pod is a one-line row. Column has a fixed max height and scrolls internally.

```
+------------------------+ +------------------------+ +------------------------+
| o node-000000  System  | | o node-000001  System  | | o node-000002  User    |
| CPU [####---] Mem [##-]| | CPU [###----] Mem [#--]| | CPU [######-] Mem [###]|
|------------------------| |------------------------| |------------------------|
| o web-7f9c  asp-demo 3m| | o ama-logs-x  kube-s 2d| | x api-55d  shop  CrashL|
|-- system (11) ---------| |-- system (11) ---------| | o api-55e  shop     4h |
| o azure-cns-a  kube  2d| | o azure-cns-b  kube  2d| | o cart-1   shop     4h |
| o cloud-node-m kube  2d| | o cloud-node-m kube  2d| |  ... 40 more   [scroll]|
| o coredns-..   kube  2d| | o coredns-..   kube  2d| |-- system (11) ---------|
|  ... 8 more    [scroll]| |  ... 8 more    [scroll]| |  ...                   |
+------------------------+ +------------------------+ +------------------------+
```

- Compact row (about 26px): status dot, pod name (middle-truncated so the hash suffix stays visible), namespace (truncated), age or reason.
- Hover: full name, namespace, image:tag, node, restarts, requests, start time. Click: Headlamp pod details.
- System vs user: user pods first, then a labeled "system (n)" divider, system rows in a muted text color. Nothing collapsed.
- Height bound: column max height about 14 rows (about 460px incl. header), internal scroll, sticky header. A "show all" toggle on the column header lifts the cap for that one column.

Tradeoffs:

- Pro: every pod name is readable without interaction. Closest to the swarm mental model. Simple to build.
- Con: nested scroll (page plus column) is awkward on trackpads and hides pods below the fold per column. At 50 pods, 70 percent of each column is out of view.
- Con: system rows take most of the visible rows on low-density user nodes, which is the common case from the scale fact.

## Option B: status tile grid

Every pod is a small square tile. No text on the card.

```
+------------------------+ +------------------------+ +------------------------+
| o node-000000  System  | | o node-000001  System  | | o node-000002  User    |
| CPU [####---] Mem [##-]| | CPU [###----] Mem [#--]| | CPU [######-] Mem [###]|
|------------------------| |------------------------| |------------------------|
| user   [#]             | | user   (none)          | | user   [X][#][#][#][#] |
|                        | |                        | |        [#][#][!][#][#] |
| system [.][.][.][.][.] | | system [.][.][.][.][.] | |        ... 50 tiles    |
|        [.][.][.][.][.] | |        [.][.][.][.][.] | | system [.][.][.][.][.] |
|        [.]             | |        [.]             | |        [.][.][.][.][.] |
+------------------------+ +------------------------+ +------------------------+
 [#] user pod  [.] system pod (smaller or outlined)  [X] error  [!] warning
```

- Tile about 18px with 4px gap: about 12 per row in a 260px column, so 50 pods fit in 5 lines (about 110px). 100 pods fit in about 220px.
- Hover: same full card as option A. Click: pod details.
- System vs user: two labeled groups; system tiles are smaller or outlined, user tiles filled. Optional tint by namespace (unsourced reasoning: risky beyond 6-8 namespaces, colors collide with status).
- Height bound: natural. No per-column scroll needed until about 150 pods per node.

Tradeoffs:

- Pro: densest option. Rows of 5 nodes stay under about 300px even at 50 pods. Best for spotting the one failing pod across tens of nodes.
- Con: no names without hover. Fails the swarm-visualizer feel where you read what runs where. Hover is not available on touch and is slow for reading 12 names.
- Con: compact cards with name, status, image tag and updated time are a Must in the draft; tiles alone do not meet that. B only works as a secondary density mode.

## Option C (recommended): split column, user rows plus system strip

User pods get option A rows; system pods get option B tiles. Column height capped.

```
+------------------------+ +------------------------+ +------------------------+
| o node-000000  System  | | o node-000001  System  | | o node-000002  User    |
| nodepool1 . 12 pods    | | nodepool1 . 11 pods    | | userpool . 61 pods     |
| CPU [####---] Mem [##-]| | CPU [###----] Mem [#--]| | CPU [######-] Mem [###]|
|------------------------| |------------------------| |------------------------|
| o web-7f9c   asp-demo  | | no user pods           | | x api-55d  shop CrashL |
|   web:1.4.2       3m   | |                        | | o api-55e  shop    4h  |
|                        | |                        | | o cart-1   shop    4h  |
|                        | |                        | |  ... 47 more  [scroll] |
|-- system 11 -----------| |-- system 11 -----------| |-- system 11 -----------|
| [.][.][.][.][.][.][.]  | | [.][.][.][.][.][.][.]  | | [.][.][.][.][.][X][.]  |
| [.][.][.][.]           | | [.][.][.][.]           | | [.][.][.][.]           |
+------------------------+ +------------------------+ +------------------------+
```

- User pod card, compact (2 lines, about 40px): dot, name, namespace; second line image tag and age or reason. This meets the draft's compact card fields (name, status dot, image tag, updated time, state).
- System tile: dot-colored square, same order on every node (sorted by owner name), so strips align across columns. Hover: full card. Click: pod details.
- System pods are always visible as tiles and counted ("system 11"). A per-column toggle expands the strip into option A rows for debugging agents.
- Height bound: header about 96px, system strip about 50px for 11-25 agents, user area capped at about 8 cards (about 320px) then internal scroll. Max column about 470px. Rows with no user pods stay short.
- unsourced reasoning: at 100 nodes and 5 per row that is still 20 rows (about 9,400px). The pool selector bounds most views; for very large pools, sort nodes with problems first and keep the page header (pool selector, counts) sticky.

Tradeoffs:

- Pro: readable where it matters, dense where pods are interchangeable agents. Bounded height. Cross-node scanning of agent health.
- Con: two visual languages in one column; needs a short legend.
- Con: depends on a reliable system pod definition. Misclassified user pods in kube-system or user DaemonSets land in the tile strip.
- Con: still has per-column scroll for user-heavy nodes (50+ user pods). The density switch to Tiles covers that case.

## Comparison

| | A rows | B tiles | C split |
|---|---|---|---|
| Max column height | about 460px, scroll | about 110px at 50 pods | about 470px, scroll |
| Pod names visible | all, within scroll | none | user pods |
| Meets compact card Must | yes | no | yes |
| System pods visible by default | yes, muted rows | yes, smaller tiles | yes, tiles |
| Problem spotting across nodes | medium | best | good |
| Build effort (unsourced reasoning) | low | low | medium |

## Headlamp components and theme

Verified in headlamp-k8s/headlamp main, frontend/src/components/common/index.ts and the referenced files:

- StatusLabel (Label.tsx): status chip with success/warning/error/'' from theme.palette. Use for state text on cards and node ready label.
- PercentageBar (Chart.tsx): props data, total, tooltipFunc. Use for CPU and memory requests vs allocatable in the node header.
- LightTooltip and TooltipIcon (Tooltip/): hover full card on tiles and truncated rows.
- DateLabel and HoverInfoLabel (Label.tsx): updated time with full timestamp on hover.
- SectionBox, SectionFilterHeader, NamespacesAutocomplete, Link, Loader, EmptyContent: page frame, pool and namespace filters, link to pod details, loading and empty states.
- Pod status mapping: getPodStatus in pod/List.tsx (see status section).

Verified in docs/development/plugins/functionality/index.md: plugins get these through @kinvolk/headlamp-plugin/lib, module CommonComponents. Same page lists shared modules including react, recharts and @material-ui/core.

Contradiction: the docs page names @material-ui/core (MUI v4 package name), while Label.tsx uses the MUI v5 style theme.palette and sx props. Which MUI package a plugin should import for Box, Grid and theme hooks is not resolved here; check the plugin template before building.

Not verified: that every export of common/index.ts is exposed under CommonComponents; that Link supports routing to a pod details page by name and namespace; that a Headlamp theme exposes a muted text token beyond MUI's palette.text.secondary.

## Open questions

- System pod definition: namespace kube-system only, or also DaemonSet-owned and other AKS add-on namespaces.
- Minimum supported AKS Desktop window width. The 1550px content area is from one screenshot; the 3 and 4 column breakpoints assume smaller windows exist.
- Whether CrashLoopBackOff should be red (error) despite Headlamp mapping it to warning.
