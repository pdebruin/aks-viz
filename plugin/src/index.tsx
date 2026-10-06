import { registerRoute, registerSidebarEntry } from '@kinvolk/headlamp-plugin/lib';
import { NodeView } from './NodeView';

registerSidebarEntry({
  parent: null,
  name: 'aks-node-viz',
  label: 'Node view',
  url: '/aks-node-viz',
  icon: 'mdi:view-column',
});

registerRoute({
  path: '/aks-node-viz',
  sidebar: 'aks-node-viz',
  name: 'aks-node-viz',
  exact: true,
  component: NodeView,
});
