# @deepseek-ai/dsh-grants

English | [中文](README.zh.md)

Durable per-workspace tool grants for the desktop approval flow. `ctx.grants`
persists records in the `desktop-grants` settings namespace and exposes
`list` / `grant` / `revoke` / `check`. The pure record algebra lives in
`./records` so approval and settings surfaces share one behavior.

## Model Experience

None; grants are host-side policy facts. The approval adapter that consumes
them (and the Settings revocation surface) is the next increment.

## Known Limitations and Deferred Work

- Writes are last-write-wins without an expected-revision guard; concurrent
  external settings edits may be overwritten.
- `grants/changed` is a log-only in-process event; durable session-level audit
  events for grant creation/use/revocation are deferred.
