# Changelog

## [Unreleased]

### Changed

* Reduced default Sage prompt-context noise in OpenClaw: ordinary prompts now get a compact Sage capability affordance instead of repeated long-form protocol orientation.
* Changed skill suggestions to quiet-by-default. Normal prompts no longer receive unsolicited `## Suggested Skills` blocks unless `autoSuggestSkills: true` is explicitly configured.
* Preserved explicit Sage discovery through `@sage`, `sage_search`, `sage_execute`, and Sage Protocol Heartbeat.
* Gated optional soul-stream injection to governance-relevant prompts instead of injecting DAO/soul context on unrelated turns.
* Clarified that capture/RLM hooks are emit-only and do not silently round-trip learned context into future prompts.

### Added

* Documented an optional, manual Sage Capability Brief workflow for explicit breakpoints. The brief uses claim/evidence/confidence/action items, prior-art search before drafts, `[SILENT]` below threshold, local-only draft gates, and separate approval for any publish/promote/tip/vote/spend action.
* Added before-prompt-build fixtures covering normal prompts, explicit Sage prompts, heartbeat prompts, and soul-stream relevance so context-size and unsolicited-suggestion behavior are regression-tested.
* Added README guidance for restoring legacy skill suggestion behavior with `autoSuggestSkills: true`.
* Clarified the U0 source-of-truth split: the published package plugin carries prompt-context behavior, while the embedded `sage init` plugin template remains bridge-only.

## [0.1.11](https://github.com/sage-protocol/openclaw-sage/compare/openclaw-sage-v0.1.10...openclaw-sage-v0.1.11) (2026-04-07)


### Features

* ci improvements ([67a2c92](https://github.com/sage-protocol/openclaw-sage/commit/67a2c920900e9577148c21cb9e6e7033555b5828))
* plugin hook logic fixes and install improvements ([30e1d56](https://github.com/sage-protocol/openclaw-sage/commit/30e1d5636a47407bd53fe09d62c1cb2b3ae382fa))

## [0.1.10](https://github.com/sage-protocol/openclaw-sage/compare/openclaw-sage-v0.1.9...openclaw-sage-v0.1.10) (2026-04-04)


### Features

* ci improvements and fix openclaw packaging validation and scanner compatibility ([3b7274d](https://github.com/sage-protocol/openclaw-sage/commit/3b7274dda59dcc448e0660eb57107c893bc3aec5))

## [0.1.9](https://github.com/sage-protocol/openclaw-sage/compare/openclaw-sage-v0.1.8...openclaw-sage-v0.1.9) (2026-04-04)


### Features

* enrich openclaw sage context payload ([e2f0f51](https://github.com/sage-protocol/openclaw-sage/commit/e2f0f513ab5836732ed12b048e12f9b268d32695))
* improve OpenClaw Sage plugin integration ([373139d](https://github.com/sage-protocol/openclaw-sage/commit/373139d7fd5cab6fb8ea8a4ba35eda2f6bcda0ea))
* surface delegation context in identity summary ([937e674](https://github.com/sage-protocol/openclaw-sage/commit/937e67421fdf20aba4c1c45cb62ef48137b4a8b4))

## [0.1.8](https://github.com/sage-protocol/openclaw-sage/compare/openclaw-sage-v0.1.7...openclaw-sage-v0.1.8) (2026-03-16)


### Features

* cleanup README.md ([e508dc6](https://github.com/sage-protocol/openclaw-sage/commit/e508dc6e648d3e24c5c7d34151f1f8bf9c977555))
* context-aware skill suggestions during heartbeat ([0777ef1](https://github.com/sage-protocol/openclaw-sage/commit/0777ef11782def8d029482c1b99ea032aa3c0ae0))
* migrate OpenClaw plugin to code mode tools ([8da4f5d](https://github.com/sage-protocol/openclaw-sage/commit/8da4f5d922b8ad0582427cacd109f76fc29d846c))
* moving hub tools out of mcp feat ([3176bf8](https://github.com/sage-protocol/openclaw-sage/commit/3176bf82848289dacf9011afbcb37849686959d7))
* update mcp to work with new codemode ([ab73b72](https://github.com/sage-protocol/openclaw-sage/commit/ab73b7288a1c56961191abe269a9bf4fac59f2a0))
* updating readme ([2749549](https://github.com/sage-protocol/openclaw-sage/commit/2749549fa59c2a1d67b8205cda4944f7ea8c0970))
* wire RLM capture hooks + fix double-prefix bug ([7e55890](https://github.com/sage-protocol/openclaw-sage/commit/7e558902a678e0ceb34320c5625b6ad94d0de919))


### Bug Fixes

* **docs:** correct sage suggest analyze → sage suggest optimize in SOUL.md ([4e29e38](https://github.com/sage-protocol/openclaw-sage/commit/4e29e38f3080896e269c7cf97bebd90ffc91f2c4))
* remove dead schema conversion code and update docs for code mode ([b3867fe](https://github.com/sage-protocol/openclaw-sage/commit/b3867fe20f5010a0ff96005305d6b38f2fe957b6))

## [0.1.7](https://github.com/sage-protocol/openclaw-sage/compare/openclaw-sage-v0.1.6...openclaw-sage-v0.1.7) (2026-02-14)


### Features

* read locally-synced soul document at agent start ([edbfb0d](https://github.com/sage-protocol/openclaw-sage/commit/edbfb0ddd84fc4cac4a6a59d422b70aff61b1cb1))


### Bug Fixes

* align OpenClaw plugin with current sage CLI and harden tests ([3b8f92f](https://github.com/sage-protocol/openclaw-sage/commit/3b8f92f45f8993c440259921993d9b77978bba19))

## [0.1.6](https://github.com/sage-protocol/openclaw-sage/compare/openclaw-sage-v0.1.5...openclaw-sage-v0.1.6) (2026-02-05)


### Features

* P0-P2 fixes — version sync, schema conversion, env passthrough, status tool, error enrichment ([5e2d6f4](https://github.com/sage-protocol/openclaw-sage/commit/5e2d6f4ab468d53cf9bf36d504cde1b32ed801f3))

## [0.1.5](https://github.com/sage-protocol/openclaw-sage/compare/openclaw-sage-v0.1.4...openclaw-sage-v0.1.5) (2026-02-04)


### Features

* suggestion improvements and hardening ([fb2c993](https://github.com/sage-protocol/openclaw-sage/commit/fb2c9930938c0552fdf29cedf57a2b24a52beb06))
* update release for npmjs ([e8c5958](https://github.com/sage-protocol/openclaw-sage/commit/e8c59583365d31b213ca5640abadcba557bbbc31))

## [0.1.4](https://github.com/sage-protocol/openclaw-sage/compare/openclaw-sage-v0.1.3...openclaw-sage-v0.1.4) (2026-02-04)


### Features

* add support for external MCP servers from mcp-servers.toml ([d7e6283](https://github.com/sage-protocol/openclaw-sage/commit/d7e62836296fb6032e62b036b8a0900d1d384198))
* auto-inject context at agent start ([6417254](https://github.com/sage-protocol/openclaw-sage/commit/6417254168f6307d42b54880c07cb46e62832514))


### Bug Fixes

* adding SOUL.md and rlm test ([2644710](https://github.com/sage-protocol/openclaw-sage/commit/26447107a4f40d675480f9d36b5bb9f058ed8e33))
* pass HOME and XDG env vars to sage subprocess for auth persistence ([653ff31](https://github.com/sage-protocol/openclaw-sage/commit/653ff3135996c1e82d916794d74fe61510a5a1fd))

## [0.1.3](https://github.com/sage-protocol/openclaw-sage/compare/openclaw-sage-v0.1.2...openclaw-sage-v0.1.3) (2026-02-02)


### Features

* add Sage capture hooks ([f8fab39](https://github.com/sage-protocol/openclaw-sage/commit/f8fab399860de55d1949c9358a443372f0617eb6))
* adding ci, release please and improvements ([c32f79a](https://github.com/sage-protocol/openclaw-sage/commit/c32f79a05ee9212d4e382c9131ec684c91706add))
* adding readme ([4aea6c9](https://github.com/sage-protocol/openclaw-sage/commit/4aea6c950e2dcf276ebcb492cfe70b6ac4cd138e))


### Bug Fixes

* fixing manifest naming ([28d6add](https://github.com/sage-protocol/openclaw-sage/commit/28d6add05e0b4e60b17993aaf73a23ef55ab1c94))
* fixing missing openclaw manifest ([5062ae7](https://github.com/sage-protocol/openclaw-sage/commit/5062ae789d2733a209ce2f0c63453779f73245fb))

## Changelog

All notable changes to this package are documented here.
