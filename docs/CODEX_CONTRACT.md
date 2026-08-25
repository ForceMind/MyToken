# Codex Contract

## Policy

Generated artifacts are version-specific. MyToken accepts only an explicitly recorded version and schema hash. Unknown versions fail closed unless an unsafe development override is set.

## Required stable surface

- `initialize` / `initialized`
- `account/read`
- `account/login/start`
- `account/login/cancel`
- `account/logout`
- `account/rateLimits/read`
- `model/list`
- `thread/start`
- `thread/resume`
- `turn/start`
- `turn/interrupt`
- `thread/delete`

## Required experimental surface for OpenClaw

- `thread/start.dynamicTools`
- `item/tool/call`
- `dynamicToolCall` items

This exception does not authorize other experimental methods.

## Verification levels

- `generated`: present in generated output.
- `schema-verified`: parsed and checked by automated contract tests.
- `runtime-verified`: observed in an opt-in live test.
