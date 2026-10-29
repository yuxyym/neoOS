# Phase 1 architecture and delivery

## Layout

```text
os/                 kernel, process table, syscall bridge, window manager, shell, boot
sdk/                public process SDK and window-frame shim
applications/<id>/  manifest.json, main.js, optional package HTML/assets
neoui/              tokenized design system and components
docs/               API, manifest, tutorial, and architecture documentation
resources/          shared OS assets
tools/              static checks
```

The kernel owns process identity, permissions, and window creation. The shell only launches manifest registrations. Apps use the public `neo` SDK. The process entry executes in an opaque-origin sandboxed iframe; the kernel fetches and inlines its JavaScript, while package window HTML is fetched by the kernel and placed in a separate sandboxed frame tied to the owning PID.

## Manifest and process contract

Manifests contain only app metadata: `id`, `name`, `version`, `description`, `icon`, `main`, `minApiVersion`, `categories`, `permissions`, `network`, `instance`, `autostart`, `associations`, `intents`, and `contributes`. Lifecycle policy adds `exitWhenLastWindowCloses`, defaulting to `true`. There are no window geometry, HTML entry, or auto-open fields. Apps open their own windows through `neo.window.create({title,width,height,minWidth,minHeight,resizable,alwaysOnTop,content})`.

## Phase 1 delivery

1. Metadata-only manifests and launcher registry; migrate the five built-in apps to manifest plus `main.js`.
2. PID-based process manager with single/multi instance behavior, process listing, focus, and kill.
3. Private `MessageChannel` request/response transport, permission checks, event bus, rate limits, audit journal, and typed API errors.
4. Public SDK, lifecycle contract, process exit, and owned-window handles.
5. Sandboxed process and window frames; kernel-side package loading supports opaque origins.
6. neoUI tokens/components, app tutorial, API reference, and task manager.

This delivery implements the process/window contract and current API surface documented in [api.md](api.md). API schema generation, broader namespaces, permission prompts, app services/intents, API Explorer, developer tools, and the full neoUI component catalog remain on the roadmap.
