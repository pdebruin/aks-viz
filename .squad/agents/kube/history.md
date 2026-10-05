# Project Context

- **Owner:** Pieter de Bruin
- **Project:** Headlamp plugin for AKS Desktop that visualizes pods per node (node columns with pod cards), with capabilities derived from dockersamples/docker-swarm-visualizer as requirements only; no code copied.
- **Stack:** TypeScript, React, Headlamp plugin SDK (@kinvolk/headlamp-plugin), Kubernetes API, AKS Desktop
- **Created:** 2026-10-05T15:24:06+02:00

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->

### 2026-10-05: v1 data layer

- NAP nodes on AKS carry `kubernetes.azure.com/agentpool=""`; check `karpenter.sh/nodepool` first.
- `headlamp-plugin test` takes no `--run`; use `CI=true npm test` for a single run. Importing the Headlamp lib in a test pulls the whole frontend; keep pure modules free of it.
- Effective request rule source: k8s.io/component-helpers/resource helpers.go (PodRequests, aggregateContainerResourcesByFn). Matches `kubectl describe node` exactly on the test cluster.
- AKS Desktop Linux dev plugin dir `~/.config/AKS-Desktop/plugins` works; the backend at 127.0.0.1:4466/plugins lists new plugins without restart.
