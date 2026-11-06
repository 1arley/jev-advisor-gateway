# Jiwo production runbook

Jiwo is an optional local decision provider for tool-choice routing. The gateway integration is
production-safe only when the service is pinned, loopback-only, supervised, and promoted using the
synthetic benchmark and canary gates below. The gateway does not install Python, download a
checkpoint, or supervise the process.

## Support boundary

The gateway sends Jiwo one bounded text-only `choice` question. It removes tool results, media,
credentials and raw request bodies. It derives the non-choice `needs_tool` answer conservatively.
Malformed, partial, unavailable and low-confidence responses fail open to the session model.
Jiwo is not used for open-ended arguments, tool execution or final answers.

## Pinned installation

Install outside the gateway checkout. The following revision was tested on 2026-11-06:

- Jiwo Git revision: `e64d36227e02a36c0ea1bc3ec669003eb5a30c29`
- Python: `3.12`
- checkpoint: `eljiwo/jiwo-0.8b`
- bind address: `127.0.0.1`
- endpoint: `http://127.0.0.1:8765/v1/systemone`

Choose an explicit service directory. `/opt/jev/jiwo` is an example; a user-owned path with spaces
also works.

```bash
install_dir=/opt/jev/jiwo
mkdir -p "$install_dir/tools" "$install_dir/bin"
UV_TOOL_DIR="$install_dir/tools" UV_TOOL_BIN_DIR="$install_dir/bin" \
  uv tool install --python 3.12 \
  --from 'git+https://github.com/jiwidi/jiwo.git@e64d36227e02a36c0ea1bc3ec669003eb5a30c29' jiwo

JIWO_CHECKPOINT=eljiwo/jiwo-0.8b \
JIWO_HOST=127.0.0.1 JIWO_PORT=8765 \
  "$install_dir/bin/jiwo" serve
```

Verify readiness before starting the gateway:

```bash
curl -fsS http://127.0.0.1:8765/health
```

The health response must report `status: "ok"` and the expected model. Keep the service directory
owned by the service account and do not expose port `8765` beyond loopback.

## User service supervision

For a user-owned installation, create a systemd user unit outside the repository:

```ini
[Unit]
Description=Jiwo local decision service
After=network-online.target

[Service]
ExecStart=/opt/jev/jiwo/bin/jiwo serve
Environment=JIWO_CHECKPOINT=eljiwo/jiwo-0.8b
Environment=JIWO_HOST=127.0.0.1
Environment=JIWO_PORT=8765
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=default.target
```

After installing the unit as `~/.config/systemd/user/jev-jiwo.service`, run:

```bash
systemctl --user daemon-reload
systemctl --user enable --now jev-jiwo.service
systemctl --user status jev-jiwo.service
curl -fsS http://127.0.0.1:8765/health
```

Review GPU access before enabling additional sandboxing. Do not use `PrivateNetwork=true`; the
service needs loopback HTTP for the gateway.

## Gateway configuration

```env
JEV_PROVIDER=jiwo
JEV_URL=http://127.0.0.1:8765/v1/systemone
JEV_MODEL=jiwo-0.8b
JEV_JIWO_MAX_STATE_CHARS=7000
JEV_MIN_CONFIDENCE=0.7
JEV_ON_NONE=passthrough
HOST=127.0.0.1
```

Run `jev-codex-advisor --setup` and select `Jiwo (local)`, or place these values in
`~/.jev-gateway/.env`. The setup wizard uses `/health` for Jiwo and does not send a paid or decision
request. Changing the Jiwo revision or checkpoint requires rerunning the benchmark and canary.

## Synthetic benchmark

Run the same corpus against Jiwo and one or more Laya checkpoints. Start both services on loopback first:

```bash
pnpm jiwo:laya:benchmark \
  --jiwo-url http://127.0.0.1:8765/v1/systemone \
  --laya-url http://127.0.0.1:8000/v1/systemone \
  --laya-models multilingual,english,typed-decisions \
  --output /tmp/jiwo-laya-report.json
```

`--laya-models` defaults to `multilingual`; the server must have each requested checkpoint loaded.
The report includes accuracy, errors, mean latency, p50 and p95 for 32 synthetic cases per provider.
The corpus covers weather, files, calendar and coding tasks, including explicit tool requests and
no-tool answers. It is a routing diagnostic, not a general model benchmark. Report every provider's
sample count and failures; do not substitute a failed response with a passing fallback.

The comparable 32-case run recorded on 2026-11-06 produced this synthetic snapshot:

| Provider               | Correct | Accuracy | Errors |   Mean |    p50 |    p95 |
| ---------------------- | ------: | -------: | -----: | -----: | -----: | -----: |
| Jiwo `jiwo-0.8b`       |   32/32 |     100% |      0 | 661 ms | 655 ms | 739 ms |
| Laya `multilingual`    |   31/32 |    96.9% |      0 | 100 ms |  98 ms | 114 ms |
| Laya `english`         |   27/32 |    84.4% |      0 | 290 ms | 283 ms | 379 ms |
| Laya `typed-decisions` |   32/32 |     100% |      0 | 291 ms | 284 ms | 369 ms |

The corpus has 32 cases across weather, files, calendar and coding tasks, with 24 explicit tool
selections and 8 no-tool cases. The multilingual error was a `read_file` request classified as
`no_tool_needed`. These are warm, sequential HTTP timings from CPU services, not a general model
benchmark or a production SLO. Jiwo's latency is higher than all three Laya checkpoints on the
observed host. The result supports protocol compatibility and a bounded synthetic canary, not
production accuracy. The JSON artifact is intentionally kept outside the package because it contains
per-case synthetic diagnostics; regenerate it with the command above.

Laya's older six-case checkpoint run recorded `multilingual` 2/6 at about 553 ms and
`typed-decisions` 3/6 at about 1323 ms. Those results used a different corpus and are not a ranking.

## Production declaration

The Jiwo integration is complete for this supported scope: an optional, loopback-only, externally
supervised `choice` router behind the existing gateway fail-open path. The following evidence was
collected on 2026-11-06 using synthetic data only:

- Jiwo `/health` reported `status: "ok"` and checkpoint `jiwo-0.8b` after the service was started
  from the pinned external installation.
- The 32-case comparison completed with zero transport errors for Jiwo and all three loaded Laya
  checkpoints. Aggregate results are recorded above.
- The 96-scenario corpus was run against Jiwo in both original and reversed tool order: 192 requests,
  175 correct (91.1%), zero transport errors, English 88/96 (91.7%), Portuguese 87/96 (90.6%),
  option-count bands 2: 46/48, 4: 44/48, 7: 44/48 and 12: 41/48. Original order was 89/96 and
  reversed order 86/96. Mean latency was 990 ms, p50 964 ms and p95 1,455 ms.
- Gateway canary traffic reached the synthetic upstream, including a correct tool selection and a
  fail-open low-confidence path that preserved a successful upstream response.
- Offline malformed, partial, invalid-choice, timeout, refusal and upstream-preservation tests pass.
- `pnpm typecheck`, `pnpm test`, `pnpm build`, `npm pack --dry-run` and `git diff --check` pass.

This declaration does not claim general model accuracy, semantic fidelity, a latency SLO, GPU/VRAM
portability, or validation with real conversations. The 96-scenario results are diagnostic evidence;
the `11+` option band is represented here by the corpus's 12-option cases. A new Jiwo revision or
checkpoint requires rerunning the health check, benchmark and synthetic canary. Rollback remains one
environment change to `JEV_PROVIDER=laya` or a hosted provider.
