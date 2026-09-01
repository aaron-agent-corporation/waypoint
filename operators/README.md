# Operators

Operators are a host extension point: an operator manifest (`*.yaml`) names a
persona — slug, name, role — and the tool surface it may use. The bundle ships
one generic example (`example/research-analyst.yaml`); a host adds its own
manifests in this directory (or loads them from anywhere with
`loadOperatorsFromDirectory`).

Manifest shape:

```yaml
schema_version: 1
slug: my-operator
name: My Operator
role: What this operator does
allowed_tools:
  - slug: my.tool
```
