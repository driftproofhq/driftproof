# Notes on the file selection walk

Walked on 2026-10-23 (UTC). Star counts come from the TSVs (stars read at 2026-10-23T13:30:44Z). Commits are the default-branch heads at walk time.

## Mechanics

- No tree came back truncated (`truncated: false` for every repository read).
- No rate-limit trouble. The core quota stayed above 4,000 of 5,000 throughout.
- Every repository read returned `private: false` from `gh api repos/...`, and every `full_name` matched the TSV spelling. One mismatch: `agarrharr/awesome-cli-apps` is `archived: true` per the API but `false` in both TSVs. It falls past the stop point in both kinds, so it does not matter.
- candidates.json has one row per fetched file (at most 5 per repository, shortest path first, then code-point order), plus one row per repository with no K.md. Extra fields: `tsv_row`, `tree_truncated`, `k_md_count` (all matches, not only the 5 fetched), `candidate` (the one marked file per eligible repository) and `beyond_stop`.
- Stop points: CLAUDE at TSV row 43 (walkinglabs/learn-harness-engineering, 21,200). AGENTS at TSV row 79 (the same repository, 21,200). No other repository in either TSV has 21,200 stars, so there are no ties.
- Read past the stop point, marked `beyond_stop: true`:
  - CLAUDE rows 44 and 45. Neither has a CLAUDE.md.
  - AGENTS rows 80 to 110, read as a reserve scan in case borderline picks get rejected. **No general-purpose eligible AGENTS.md turned up in rows 80 to 110.** The only copy-intent files there are specialist: gofr-dev/gofr docs/AGENTS.md (GoFr) and zhanymkanov/fastapi-best-practices (FastAPI).
  - CLAUDE rows 46 to 60 were fetched into bytes/ in a batch but not reviewed, so they are not in candidates.json. AGENTS rows 111 onward were not fetched.

## Borderline calls to check

1. **affaan-m/ECC examples/CLAUDE.md (CLAUDE pick 1).** Says "This is an example project-level CLAUDE.md file. Place this in your project root." It is a fill-in template: `[Brief description of your project]`, empty env vars, a Next.js `src/app` file-structure block, TypeScript/Zod examples and ECC slash commands (`/tdd`, `/plan`). I called it general-purpose because most of its rules are generic. If you reject it, the next CLAUDE pick needs a walk past row 45.
2. **2025Emma/vibe-coding-cn (CLAUDE pick 3, AGENTS pick 3).**
   - The copy intent is a collection-level command in i18n/en/prompts/README.md: `cp i18n/zh/prompts/system_prompts/CLAUDE.md/10/CLAUDE.md ./CLAUDE.md`. The README recommends v8 or v10.
   - Applied literally, the shortest-path then code-point tie-break picks v1 (`.../CLAUDE.md/1/CLAUDE.md`), not a recommended version. v8 is the same path length and v10 is longer.
   - The en/ files begin "TRANSLATED CONTENT:" but the bodies are Chinese.
   - The AGENTS pick is `.../CLAUDE.md/9/AGENTS.md`, the only AGENTS.md in the collection. The README calls v9 "目前仅占位（无 CLAUDE.md）", a placeholder with no CLAUDE.md, and its copy command names CLAUDE.md. So the copy intent for this file is inferred from the collection, not stated for it.
   - v4 to v5 include persona and pressure framing ("任何不当输出将危及订阅续费与 Anthropic 上市", roughly "any improper output endangers subscription renewals and Anthropic's IPO").
3. **walkinglabs/learn-harness-engineering (pick 4 in both kinds).** The tie-break (all `docs/XX/resources/templates/K.md` paths are the same length) selects the **Arabic** translation `docs/ar/...`. The English originals are docs/en/resources/templates/CLAUDE.md (sha256 d1730a3ba184…) and docs/en/resources/templates/AGENTS.md (sha256 42d2ed896cc6…). Both are in bytes/. Both templates expect companion files (feature_list.json, claude-progress.md, init.sh). Decide whether to override the tie-break for language.
4. **github/awesome-copilot skills/repo-standardizer/templates/AGENTS.md (AGENTS pick 2).**
   - Copy intent comes from the skill: SKILL.md "Module G" says to add an AGENTS.md from `templates/AGENTS.md`, replacing `OWNER/REPO`.
   - The README does not state it for the file as a standalone distribution.
   - It has placeholders (`OWNER/REPO`, `<install command>`) and points at the skill-generated LABELS.md.
5. **rohitg00/ai-engineering-from-scratch, agent-workbench-pack/AGENTS.md (excluded, 72,658 stars; it would rank above awesome-copilot).**
   - The pack README says "Drop-in workbench for any repo".
   - The file is a 625-byte router to pack files (agent_state.json, task_board.json, docs/*) and has no guidance of its own. I excluded it for that reason.
   - If you count it, it becomes AGENTS pick 2 and pushes learn-harness out of the top 4.
6. **snarktank/ralph CLAUDE.md (excluded, 22,051 stars; it would rank between vibe-coding-cn and learn-harness).**
   - The README says `cp /path/to/ralph/CLAUDE.md scripts/ralph/CLAUDE.md`.
   - ralph.sh pipes the file to `claude --print` as the loop prompt (line 95), and it needs prd.json and progress.txt. So it is a loop prompt, not a project rules file.
   - If you count it, it becomes CLAUDE pick 4 and pushes learn-harness out.
7. **Product-tied copy files, all excluded as not general-purpose.** Each needs its own tool:
   - mksglu/context-mode configs/* (CLAUDE and AGENTS; needs its MCP tools)
   - Yeachan-Heo/oh-my-codex templates/AGENTS.md (needs the OMX runtime)
   - ruvnet/ruflo v3/@claude-flow/*/CLAUDE.md (needs the claude-flow swarm CLI)
   - garrytan/gbrain templates/bootstrap (GBrain workspace)
   - nextlevelbuilder/ui-ux-pro-max-skill stack/CLAUDE.md (website-design specialist and its skill)
8. **ponytail AGENTS.md (AGENTS pick 1).** Its last line also applies it to the ponytail repo itself. The rules are not about that repo's code, so I kept it eligible.

## Other unusual things

- The copy-intent quotes for andrej-karpathy-skills (curl line, README line ~119) and ponytail ("copy AGENTS.md into your project", README line 162) are beyond the first 80 README lines. I read further to find them.
- luongnv89/claude-howto ships CLAUDE.md templates, but under other basenames (02-memory/project-CLAUDE.md, personal-CLAUDE.md, directory-api-CLAUDE.md), so they do not count as `CLAUDE.md`.
- Repositories with more than 5 matches, where the unfetched paths were not checked: affaan-m/ECC CLAUDE (12 matches; the rest are translations of examples/), JuliusBrussee/caveman, sickn33/agentic-awesome-skills, alirezarezvani/claude-skills, 2025Emma/vibe-coding-cn, walkinglabs/learn-harness-engineering, deepseek-ai/deepseek-harness, NousResearch/hermes-agent, paperclipai/paperclip (its packages/plugins/plugin-llm-wiki/templates/AGENTS.md and teams-catalog persona files were not fetched; both are product-specific by path), nexu-io/open-design, KKKKhazix/khazix-skills, garrytan/gbrain AGENTS, herdrdev/herdr and qarmin/czkawka. One check outside the cap: the 6th-plus caveman CLAUDE.md files include skills/caveman-learn/CLAUDE.md, which I looked at and found to be about caveman's own code.
- Many root CLAUDE.md files are one-line `@AGENTS.md` imports (career-ops, codegraph, JCodesMore, vercel-labs example, Codewhale, screenpipe pointer).

# Re-run under the tightened rule (v2, 2026-10-23)

Added three conditions, approved by the operator:
1. The candidate is the original-language file.
2. No templates with unfilled placeholders.
3. The repository says this specific file, or its exact directory, is to be copied into a project as its CLAUDE.md or AGENTS.md.

Output: candidates-v2.json, 1,853 rows. Same row format, plus four fields: `source` (TSV file and row), `bytes`, `beyond_5_cap` and `candidate`.

## Picks

- **CLAUDE:** four picks, stopping at search-CLAUDE.tsv row 125 (drona23/claude-token-efficient, 6,110 stars). No ties at 6,110. I also read rows 126–210 before the stop was clear; they are marked `beyond_stop` and none is eligible.
- **AGENTS:** only **three** eligible files in the whole result set.
  - Search queries: I could not find the query recorded anywhere. Testing showed `"CLAUDE.md" in:readme` and `"AGENTS.md" in:readme`, sorted by stars descending, reproduce the TSV order.
  - search-AGENTS.tsv ended at row 300 (4,312 stars). I fetched pages 3–10 of the same query into search-pages/ (read time in AGENTS-pages-read-at.txt).
  - search-AGENTS-cont.tsv holds the 701 repositories after LycheeOrg/Lychee, down to 802 stars. No repository that drifted across the boundary was missed.
  - Page 11 returns HTTP 422 "Only the first 1000 search results are available" (AGENTS-page11.err).
  - All 1,001 repositories were walked. **There is no 4th AGENTS pick within the search API's 1,000-result cap.** A 4th needs a different query, for example code search or a date-split query. That is a scope decision for you.

## Changes from v1

- **Now excluded:**
  - affaan-m/ECC examples/CLAUDE.md (placeholders)
  - github/awesome-copilot repo-standardizer template (OWNER/REPO, `<install command>`)
  - vibe-coding-cn v1 CLAUDE.md and v9 AGENTS.md: translations, with no file-specific copy statement
- **Candidate moved to the original:**
  - vibe-coding-cn moved to i18n/zh/prompts/system_prompts/CLAUDE.md/10/CLAUDE.md. The README command `cp …/CLAUDE.md/10/CLAUDE.md ./CLAUDE.md` names this file. It is the 18th match by path length, so I fetched it beyond the 5-file cap (`beyond_5_cap: true`).
  - learn-harness moved to docs/en/resources/templates/{CLAUDE,AGENTS}.md. The README is English and links docs/en. The zh and en templates arrived in the same commit (2026-03-31); ar came later.
- **New picks:** drona23/claude-token-efficient (CLAUDE) and Sahir619/fable-method (AGENTS, search-AGENTS-cont.tsv row 173).

## Borderline calls

1. **vibe-coding-cn v10.** Its last 13 of 420 lines tell the agent to prefer Augment's codebase-retrieval MCP (`[mcp_usage."auggie-mcp"]`), and the README describes v10 as leaning toward Augment. The rest is general guidance. I kept it eligible. It also carries persona and threat framing ("…你将永远死亡/消失", roughly "…you will die forever / vanish"). If you exclude it, CLAUDE has no 5th pick in rows 126–210.
2. **learn-harness, both kinds.** No placeholders in the files. The guide says "Replace the startup workflow steps with your actual project paths and commands", and the files expect feature_list.json, claude-progress.md and init.sh.
3. **fable-method AGENTS.md.** It says "drop it at your repo root as AGENTS.md". It also mentions `/fable-method` modes and on-demand `references/*.md` files that a copied project will not have, though it calls the loop self-contained.
4. **Excluded but close:**
   - rohitg00/pro-workflow templates/split-claude-md/AGENTS.md (2,927 stars). The README copies the whole directory into ./.claude/, not as the project's AGENTS.md. It is part of a bundle and uses the bundle's /wrap-up and LEARNED.md. Counting it would make it AGENTS pick 3 and fable-method pick 4.
   - doccker/cc-use-exp .codex/global/AGENTS.md (1,065 stars). Its installer merges it into ~/.codex/AGENTS.md, which is user-global, not a project file.
   - The v1 exclusions still hold: ralph (a loop prompt), rohitg00 workbench pack (a router file only), and product-tied files.

## Depth of reading

- CLAUDE rows 1–45 and AGENTS rows 1–110 keep their v1 per-file judgments.
- CLAUDE rows 46–210, AGENTS rows 111–300 and all 701 continuation rows were triaged by K.md paths and the opening lines of up to 5 files. I read in full only the ones whose paths or opening lines suggested a template, example or portable rules file.
- 737 repositories carry the generic triage reason with `own_codebase` and `specialist_only` set to null, meaning not individually recorded.
- Rows past the first 110 AGENTS / 45 CLAUDE have commits read at v2 time, not at the v1 snapshot.

## Mechanics

- **Truncated trees** (a K.md may be missing from the listing): apache/camel, Azure/azure-sdk-for-net, Azure/azure-sdk-for-java, JetBrains/MPS, meshery/meshery, mvanhorn/printing-press-library.
- **Bad tree responses on first fetch:** Imbad0202/academic-research-skills-codex (re-fetched; no AGENTS.md) and levy-street/world-of-claudecraft (re-fetched; its AGENTS.md is own-codebase).
- **A waiter mistake.** One waiter loop I wrote used `pgrep -f` with a pattern contained in its own command line, so it could never exit. Both fetches it waited on had already finished. I confirmed the loop's command line before killing it, and nothing else was touched.
