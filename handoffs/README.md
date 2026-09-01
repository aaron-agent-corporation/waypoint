# Handoffs

Handoff manifests (`*.yaml`) are a host extension point: a handoff packages a
route's state for another operator to pick up. The bundled set is empty; a
host ships its own manifests in this directory (or loads them from anywhere
with `loadHandoffManifestsFromDirectory`).
