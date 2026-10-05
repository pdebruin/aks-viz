# Project Context

- **Owner:** Pieter de Bruin
- **Project:** Headlamp plugin for AKS Desktop that visualizes pods per node (node columns with pod cards), with capabilities derived from dockersamples/docker-swarm-visualizer as requirements only; no code copied.
- **Stack:** TypeScript, React, Headlamp plugin SDK (@kinvolk/headlamp-plugin), Kubernetes API, AKS Desktop
- **Created:** 2026-10-05T15:24:06+02:00

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->

### 2026-10-05: v1 node view

- PodView carries phase only. Headlamp's pod colors need the Ready condition, so the view derives status from raw pod JSON (presentation.ts podUiStatus) in useNodeViewModel, which composes useClusterResources and buildNodePoolView.
- SDK routes: "Pod" (/pods/:namespace/:name), "node" (/nodes/:name), "DaemonSet". getRoute matches case-insensitively.
- Headlamp Link with the `tooltip` prop triggers a "function components cannot be given refs" warning; use a plain title attribute instead.
- Render tests of CommonComponents in vitest need: redux Provider with lib/redux/stores/store (default export), ThemeProvider with createMuiTheme from lib/lib/themes, a ResizeObserver stub for PercentageBar, and a longer timeout (lib import takes about 4.5s). See src/components/NodeView.test.tsx.
- react-router-dom v5 (useHistory, useLocation) is shared by Headlamp as pluginLib.ReactRouter.

### 2026-10-05: v1.1 grouping by pod kind

- On AKS, most system pods on a node are DaemonSet agents identical across nodes (11 on hostedpool). Collapsing them to a status line and listing the rest by name made 14 to 26 pods per node readable without hover.
- Alignment across columns only holds if every column lists the same rows; placeholder rows for gaps and ineligible DaemonSets plus one shared toggle do that.
- Hashing names straight onto an 8-color palette collided 3 of 6 on hostedpool. Assign colors per view with probing from the hashed slot, and add a murmur finalizer to FNV-1a since the low bits are weak.
- Visual check without AKS Desktop: render NodeView in vitest (jsdom, `// @vitest-environment jsdom`) with live JSON from kubectl, write container HTML plus document.styleSheets rules with a utf-8 meta tag, serve over http (Playwright blocks file:), screenshot. Recharts bars do not render there.
