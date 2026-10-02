#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# Spec 042: the Report 009 model guard (bundle three-skill-comparison/guard.py), ported to
# this host. It stands in for `claude` on the runner's PATH. Differences from the original,
# each forced by the re-run and nothing else:
#   - the allowed --model set is {claude-opus-5-5 (target), claude-opus-5 (judge)}; the
#     original allowed claude-opus-5 only, because target and judge were the same model;
#   - utility-model overrides name the model of the call being made, not claude-opus-5;
#   - paths come from the environment (GUARD_OUT, GUARD_CLAUDE_BIN) instead of a home path.
# Kept as the original: the 240-call global cap, no --fallback-model, stream-json, tools,
# hooks, MCP and session persistence off, a 240 s timeout per call, every prompt, argv and
# stream kept, and a Fable model in the result's modelUsage refused.
import sys, os, json, subprocess, fcntl
from pathlib import Path

ALLOWED = {'claude-opus-5-5', 'claude-opus-5'}
OUT = Path(os.environ['GUARD_OUT'])
CLAUDE = os.environ['GUARD_CLAUDE_BIN']
args = sys.argv[1:]
base = OUT / 'driftproof-calls'
base.mkdir(parents=True, exist_ok=True)
if '--model' not in args or args[args.index('--model') + 1] not in ALLOWED or '--fallback-model' in args:
    sys.exit('MODEL GUARD REFUSED')
model = args[args.index('--model') + 1]
with (base / 'lock').open('w') as f:
    fcntl.flock(f, fcntl.LOCK_EX)
    counter = base / 'count'
    n = int(counter.read_text()) if counter.exists() else 0
    if n >= 240:
        sys.exit('GLOBAL CALL CAP REACHED')
    counter.write_text(str(n + 1))
prompt = sys.stdin.read()
env = dict(os.environ)
for k in ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'DRIFTPROOF_STUB']:
    env.pop(k, None)
env.update(ANTHROPIC_SMALL_FAST_MODEL=model, ANTHROPIC_DEFAULT_HAIKU_MODEL=model,
           ANTHROPIC_DEFAULT_SONNET_MODEL=model, ANTHROPIC_DEFAULT_OPUS_MODEL=model)
if '--output-format' in args:
    args[args.index('--output-format') + 1] = 'stream-json'
extra = ['--verbose', '--setting-sources', '', '--settings', '{"disableAllHooks":true}',
         '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--no-session-persistence',
         '--permission-mode', 'dontAsk', '--tools', '']
cmd = [CLAUDE, *args, *extra]
dest = base / f'{n + 1:03d}'
dest.mkdir()
(dest / 'prompt.txt').write_text(prompt)
(dest / 'command.json').write_text(json.dumps(cmd, indent=2))
r = subprocess.run(cmd, input=prompt, text=True, capture_output=True, env=env, timeout=240)
(dest / 'stdout.jsonl').write_text(r.stdout)
(dest / 'stderr.txt').write_text(r.stderr)
rows = []
for line in r.stdout.splitlines():
    try:
        rows.append(json.loads(line))
    except Exception:
        pass
results = [x for x in rows if x.get('type') == 'result']
result = results[-1] if results else None
(dest / 'metadata.json').write_text(json.dumps({'label': os.environ.get('TEST_RUN_LABEL'), 'exit': r.returncode,
                                                'requested_model': model,
                                                'model_usage': sorted((result or {}).get('modelUsage', {}))}))
if result:
    if any('fable' in m.lower() for m in result.get('modelUsage', {})):
        sys.exit('FORBIDDEN MODEL OBSERVED')
    sys.stdout.write(json.dumps(result))
else:
    sys.stderr.write(r.stderr or 'No final CLI result')
sys.exit(r.returncode)
