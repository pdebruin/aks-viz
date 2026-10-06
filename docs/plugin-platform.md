# Plugin platform: building, running and loading a Headlamp plugin in AKS Desktop

Author: Kube. Date: 2026-10-05. Status: research findings, no code written.

## Conclusion

Build with `@kinvolk/headlamp-plugin` 0.14.0 on Node 22+. AKS Desktop is not a Headlamp fork or submodule: it pins one Headlamp commit and applies a patch series. The SDK version does not need to match; Headlamp only rejects plugins built with SDK versions below 0.8.0-alpha.3.

Dev loop: `npm start` copies the plugin into the `Headlamp` profile directory, but packaged AKS Desktop reads plugins from its own `AKS-Desktop` profile directory. This repo runs the AKS Desktop Linux package inside WSL and installs with `npm run install:aks-desktop` (plugin/scripts/install-dev.sh), which builds and copies `dist/main.js` and `package.json` into `~/.config/AKS-Desktop/plugins/<name>/`, or `~/.local/share/AKS-Desktop/plugins/<name>/` if that directory exists.

## Sources read

Read on 2026-10-05. The Headlamp repo now lives at github.com/kubernetes-sigs/headlamp (headlamp-k8s/headlamp redirects there). Source files were read at the commit AKS Desktop pins (d4c87a8f). The getting-started, building, common-patterns and publishing docs were read from Headlamp main.

- Azure/aks-desktop main: package.json, .nvmrc, README.md, plugins/README.md, plugins/insights-plugin/README.md, plugins/plugin-catalog/README.md, plugins/aks-desktop/package.json, plugins/aks-desktop/src/index.tsx, packages/headlamp-source/README.md, patches/series and the patch files.
- kubernetes-sigs/headlamp at d4c87a8f: app/package.json, app/electron/main.ts, app/electron/plugin-management.ts, app/electron/runtimeProductIdentity.ts, app/electron/env-paths.ts, app/electron/developmentPlugins.ts, plugins/headlamp-plugin/package.json, plugins/headlamp-plugin/bin/headlamp-plugin.js, plugins/headlamp-plugin/config/vite.config.mjs, frontend/src/plugin/index.ts, frontend/src/lib/k8s/KubeObject.ts, frontend/src/lib/k8s/api/v2/useKubeObjectList.ts, frontend/src/lib/k8s/api/v1/queryParameters.ts, plugins/examples/sidebar/src/index.tsx, plugins/examples/pod-counter/src/index.tsx, docs/development/plugins/functionality/index.md.
- npm registry: @kinvolk/headlamp-plugin metadata, plus the 0.14.0 tarball (bin/headlamp-plugin.js, package.json, config/vite.config.mjs). Downloaded and unpacked to read, not installed.

## 1. SDK, scaffold, build, Node version

- Package: `@kinvolk/headlamp-plugin`. npm `latest` is 0.14.0, published 2026-05-12. Before that came 0.13.1 (2026-02-04). Source: npm registry metadata, dist-tags and time.
- Scaffold: `npx --yes @kinvolk/headlamp-plugin create <name>`. Source: Headlamp docs, development/plugins/getting-started.md, "Step 1: Create the Plugin". The `create <name>` command exists in the published 0.14.0 bin/headlamp-plugin.js.
- Dev: `npm run start`, which builds, watches and copies into the plugins directory. Source: getting-started.md, "Step 4: Start Development Mode".
- Build and package: `npm run build`, then `npm run package`, which produces a tarball. Other scripts: `format`, `lint`, `lint-fix`, `tsc`, `test`. Source: getting-started.md, "Development Workflow" and "Building for Production". AKS Desktop's own plugin uses the same scripts (`headlamp-plugin start/build/package/lint/tsc`). Source: aks-desktop plugins/aks-desktop/package.json, scripts.
- Node: the Headlamp docs require Node 22.0.0 or later and npm 11.0.0 or later. Source: getting-started.md, "Prerequisites". The published SDK package.json declares no `engines` field. The AKS Desktop monorepo requires Node >=22.22.2 and npm >=10, and its .nvmrc pins 22.22.2. Source: aks-desktop package.json `engines`, .nvmrc. The two npm minimums differ (11 in the Headlamp docs, 10 in the AKS Desktop repo). The AKS Desktop repo minimum only applies when building AKS Desktop itself.

## 2. Headlamp base and SDK version matching

- Pinned commit, not a submodule or fork. AKS Desktop depends on a local package `@headlamp-k8s/headlamp-source` (`file:packages/headlamp-source`). That package fetches `https://github.com/kubernetes-sigs/headlamp.git` at the revision in `package.json#headlampSource.revision`, which is `d4c87a8fa3cc109b3ba992ca12e8eda45f5c77f0`. Source: aks-desktop package.json (`headlampSource`, `devDependencies`); packages/headlamp-source/README.md, "headlampSource". The README also gives the generated package version, `0.0.0-main.d4c87a8f`.
- Patches: patches/series lists 10 patches. Eight are labelled `headlamp-upstream-*` (for example rsbuild-default, aks-cluster-registration, product-command-preapproval). Two are AKS-specific: cluster-pre-open-proxies and aks-desktop-host-marker. None of them touch the plugin directory functions (searched for `setAppConfigDirName`, `pluginConfigDirName`, `env-paths`). Source: aks-desktop patches/.
- Headlamp version at that commit: app/package.json says 0.45.0. Source: headlamp app/package.json at d4c87a8f. unsourced reasoning: since AKS Desktop pins a main-branch commit, this is 0.45.0 plus later unreleased commits, not necessarily the 0.45.0 release.
- AKS Desktop release: v0.10.0, 2026-09-24. The root package.json is also 0.10.0. Source: GitHub releases API; aks-desktop package.json.
- SDK matching is not required. The frontend sets `compatibleHeadlampPluginVersion = '>=0.8.0-alpha.3'` and marks a plugin incompatible only if its `devDependencies['@kinvolk/headlamp-plugin']` falls outside that range. Source: headlamp frontend/src/plugin/index.ts, `filterSources` and the settings compatibility block.
- Reference point: AKS Desktop's own plugin uses `@kinvolk/headlamp-plugin` `^0.13.1`. Source: aks-desktop plugins/aks-desktop/package.json.
- Contradiction: plugins/headlamp-plugin/package.json at d4c87a8f says version 0.14.0, but its bin/headlamp-plugin.js differs from the npm 0.14.0 tarball (2156 vs 2036 non-blank lines). The pinned source mentions Plugin Development Mode; the published one does not. unsourced reasoning: the pinned source is post-0.14.0 work that still carries the 0.14.0 version string. The difference does not affect loading, because the compatibility gate is the >=0.8.0-alpha.3 range.

## 3. How AKS Desktop loads plugins

### Three plugin directories

The Electron main process lists plugins from three places. Source: headlamp app/electron/main.ts, plugin listing handler ("Lists plugins from all three directories") and backend server args.

- Shipped: `<resources>/.plugins`, bundled with the app. Passed to the backend as `HEADLAMP_STATIC_PLUGINS_DIR`.
- User-installed: `<appData>/user-plugins`. The Plugin Catalog installs here. Source: plugin-management.ts, `defaultUserPluginsDir` and the install functions whose default destination is `defaultUserPluginsDir()`.
- Development: `<appData>/plugins`. Source: plugin-management.ts, `defaultPluginsDir`; main.ts labels this list "development plugins". Packaged apps only load from here when Plugin Development Mode is on (Settings > Plugins, with a confirmation dialog). Source: getting-started.md, "Step 4"; app/electron/developmentPlugins.ts, `confirmEnableDevelopmentPlugins`.

### Where appData resolves for AKS Desktop

- `<appData>` comes from `envPaths(appConfigDirName)`. It is the data path if that exists, otherwise the config path. Source: plugin-management.ts, `defaultAppDataDir`.
- `appConfigDirName` is `'Headlamp'` in development mode. In the packaged app it is the Electron app name. Source: main.ts line `setAppConfigDirName(pluginConfigDirName(app.getName(), isDev))`; runtimeProductIdentity.ts, `pluginConfigDirName`.
- The packaged app renames itself to the manifest `productName`. Source: runtimeProductIdentity.ts, `applyRuntimeProductIdentity`. For AKS Desktop that is `AKS desktop`, or `AKS-Desktop` on Linux. Source: aks-desktop package.json `headlamp.product.productName` and `headlamp.build.productNames.linux`; packages/headlamp-source/README.md, "build" table (productNames replaces productName).
- env-paths on Windows: data is `%LOCALAPPDATA%\<name>\Data` and config is `%APPDATA%\<name>\Config`. On Linux: data is `$XDG_DATA_HOME|~/.local/share/<name>` and config is `$XDG_CONFIG_HOME|~/.config/<name>`. Source: app/electron/env-paths.ts.

Resulting paths. unsourced reasoning: derived from the code above, not observed on a machine.

| Install | Development plugins dir | User plugins dir |
|---|---|---|
| AKS Desktop packaged, Windows | `%LOCALAPPDATA%\AKS desktop\Data\plugins` if `...\Data` exists, else `%APPDATA%\AKS desktop\Config\plugins` | same base, `user-plugins` |
| AKS Desktop packaged, Linux | `~/.local/share/AKS-Desktop/plugins` if it exists, else `~/.config/AKS-Desktop/plugins` | same base, `user-plugins` |
| Any Headlamp-based app in dev mode (`npm run dev`) | `~/.local/share/Headlamp/plugins` or `~/.config/Headlamp/plugins` | same base, `user-plugins` |

### Docs vs code

- The Headlamp docs list the desktop plugin directory as `$HOME/.config/Headlamp/plugins` (Linux/macOS) and `%APPDATA%/Headlamp/Config/plugins` (Windows). Source: building.md, "Manual installation" table.
- That does not hold for AKS Desktop. The code uses the product name, not `Headlamp`, and prefers the data dir over the config dir. Also, the `plugins` directory the docs point to is the development directory in the code, which packaged apps load only when Plugin Development Mode is on.

### `npm start` target and the install script

- `headlamp-plugin start` copies the build to `envPaths('Headlamp')/plugins/<package-name>`, preferring data over config. The name `Headlamp` is hardcoded. This is true in both the published 0.14.0 bin and the pinned source. Source: bin/headlamp-plugin.js, `copyToPluginsFolder`.
- Packaged AKS Desktop uses the profile name `AKS-Desktop`, so it reads `~/.config/AKS-Desktop/plugins` (or the `~/.local/share` variant), not the `Headlamp` path. Source: AKS Desktop 0.10.0 deb, resources/app/build/main.js.
- `npm run install:aks-desktop` builds and copies into the AKS Desktop path, mirroring the data-before-config rule. Source: plugin/scripts/install-dev.sh.

### Enabling

In app mode a plugin loads only if it is enabled in settings. Source: frontend/src/plugin/index.ts, `filterSources`, "No plugins should be enabled if settings are not set" and `isEnabled`. The Insights README tells users to toggle the plugin in Settings > Plugins. Source: plugins/insights-plugin/README.md, "Step 2: Enable the Insights Plugin". Whether a newly dropped-in development or user plugin is enabled by default was not verified.

### Plugin Catalog

- AKS Desktop bundles `@headlamp-k8s/plugin-catalog` from `plugins/plugin-catalog`, enabled by default. Source: aks-desktop package.json `headlamp.plugins`.
- The catalog lists Headlamp plugins from ArtifactHub and can install and remove them. Source: publishing.md, intro; plugins/plugin-catalog/README.md. AKS Desktop allows proxying `https://artifacthub.io/api/v1/packages/*`. Source: aks-desktop package.json `headlamp["proxy-urls"]`.
- By default only official plugins are shown; users can switch to show all. Source: building.md, "Plugins in Headlamp Desktop".
- Publishing needs `artifacthub-repo.yml`, `artifacthub-pkg.yml` with `headlamp/plugin/archive-url`, `archive-checksum`, `version-compat`, `distro-compat`, and registration on ArtifactHub. Source: publishing.md, Steps 1 to 5. Valid `distro-compat` values for AKS Desktop were not found.

## 4. Registration and data APIs

All of these come from `@kinvolk/headlamp-plugin/lib`. Source: functionality/index.md, "Plugins Lib".

- Route: `registerRoute({ path, sidebar, name, exact, component })`. Source: functionality/index.md, "Route"; plugins/examples/sidebar/src/index.tsx.
- Sidebar: `registerSidebarEntry({ parent, name, label, url, icon })`. `entryType: 'subheader'` adds a section header. Filters: `registerSidebarEntryFilter` and `registerHomeSidebarEntryFilter`. Source: functionality/index.md, "Sidebar Item"; examples/sidebar. Cluster routes resolve under `/c/<cluster>/...` (example comment: "The sidebar link URL is: /c/mycluster/feedback").
- AKS Desktop's own plugin uses `registerRoute`, `registerSidebarEntry` and `registerProjectDetailsTab`. Source: aks-desktop plugins/aks-desktop/src/index.tsx.
- K8s lists: `K8s.ResourceClasses.Node.useList(...)` and `K8s.ResourceClasses.Pod.useList(...)`. Source: examples/pod-counter/src/index.tsx (`K8s.ResourceClasses.Pod.useList()`); frontend/src/lib/k8s/KubeObject.ts, `static useList`.
  - Options: `cluster`, `clusters`, `namespace`, `requests`, `refetchInterval`, plus query parameters including `labelSelector` and `fieldSelector`. Source: KubeObject.ts `useList` signature; api/v1/queryParameters.ts.
  - Return value: an object with `items` and `errors`, which can also be destructured as `[items, error]`. Source: useKubeObjectList.ts, return object and `[Symbol.iterator]`.
- Lists are watch-based by default. `useKubeObjectList` defaults to `watch = true` and calls `useWatchKubeObjectLists`, using the WebSocket multiplexer when it is enabled (default true). Setting `refetchInterval` disables watching ("Disables watching if set"). Source: useKubeObjectList.ts, `useKubeObjectList`, `getWebsocketMultiplexerEnabled`; KubeObject.ts `useList` doc comment.
- unsourced reasoning: for the node pool selector, `Node.useList({ labelSelector: 'kubernetes.azure.com/agentpool=<pool>' })` or a client-side filter on both labels should work. Grouping pods by `spec.nodeName` client-side keeps this to one Pod watch instead of one watch per node.

## 5. MUI version

Contradiction, reported as found:

- The docs say MUI v4. The "Shared Modules" list names `@material-ui/core` and `@material-ui/styles`. Source: functionality/index.md, "Shared Modules".
- The docs also say MUI v5. The "Shared Dependencies" list names `@mui/material` and `@mui/lab`, and the examples import `@mui/material`. Source: getting-started.md, "Shared Dependencies" and Step 6.
- The SDK depends on v5. The published 0.14.0 package.json has `@mui/material ^5.15.14`, `@mui/system ^5.15.14`, `@mui/icons-material ^5.16.7`, `@mui/lab ^5.0.0-alpha.152`, `@mui/x-date-pickers ^7.15.0`, `@mui/x-tree-view ^6.17.0`. The pinned source package.json lists the same ranges. Source: npm registry 0.14.0; headlamp plugins/headlamp-plugin/package.json at d4c87a8f.
- The build externalises the v5 package names. vite.config.mjs maps `@mui/material` to `pluginLib.MuiMaterial`, `@mui/lab` to `pluginLib.MuiLab`, and `@mui/styles` to `pluginLib.MuiStyles`, so plugins use the host's copy rather than bundling their own. No `@material-ui/*` mapping is present. Source: config/vite.config.mjs `externalModules`, in both the 0.14.0 tarball and the pinned source.
- Also shared from the host: `react` (the SDK depends on `^18.3.1`), `react-router` and `recharts`. Source: vite.config.mjs `externalModules`; 0.14.0 package.json.

## 6. Bundled plugins and existing node/pod views

AKS Desktop bundles 4 plugins. Source: aks-desktop package.json `headlamp.plugins`.

- aks-desktop
- ai-assistant (`@headlamp-k8s/ai-assistant` 0.4.1-alpha)
- insights-plugin
- plugin-catalog

None of them registers a pods-per-node view. aks-desktop registers Azure, project and cluster-registration routes and project tabs (Info, Deploy, Logs, Metrics, Scaling, Access). Source: plugins/aks-desktop/src/index.tsx. insights-plugin adds an Insights tab in the project view (eBPF data mapped to pods and nodes). Source: plugins/insights-plugin/README.md, "Overview".

Existing Headlamp core views to avoid duplicating:

- Nodes list and Pods list
- Resource Map with group-by node: `GroupBy = 'node' | 'namespace' | 'instance'`. Source: frontend/src/components/resourceMap/graph/graphGrouping.tsx at d4c87a8f.

## Not found or not verified

- The actual plugin directory on the user's Windows machine. Check whether `%LOCALAPPDATA%\AKS desktop\Data` exists.
- Whether newly added development or user plugins are enabled by default in AKS Desktop.
- Whether the packaged app reloads on changes in the plugins dir without a restart.
- Valid ArtifactHub `distro-compat` values for AKS Desktop.
- An AKS Desktop doc on third-party plugin development. aks-desktop README.md covers building AKS Desktop itself. The docs/ filenames show no plugin development guide; the files were not read.
