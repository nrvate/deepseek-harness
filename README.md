# DeepSeek Harness

English | [中文](README.zh.md)

DeepSeek Harness (`dsh`) is an open-source agent harness developed by [DeepSeek AI](https://deepseek.com).

It is built on an **everything-is-a-plugin** architecture and powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512).

Documentation: [https://deepseek-harness.github.io/deepseek-harness/](https://deepseek-harness.github.io/deepseek-harness/)

## Developer preview

DeepSeek Harness is in _developer preview_ and iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

Review the [safety notice](SAFETY.md) before running the project.

## This fork

This checkout is [nrvate's fork](https://github.com/nrvate/deepseek-harness) of DeepSeek Harness. It tracks upstream `master` and adds what the list below names; none of it is upstream. [FORK.md](FORK.md) is the fork's reference for the defaults that differ, the packages that exist only here, and what changes for a deployment.

- **MCP servers on the Plugins page** — add, edit, test, enable, disable, and remove the servers the MCP manager runs, read each server's tools and usage, and watch them from an **MCP 2/3** status item and a per-session selector below the prompt box. See the [MCP servers page](packages/client/ui-settings-mcp-servers/README.md) and the [MCP subsystem](docs/subsystems/mcp.md).
- **Per-session MCP servers** — a Session carries the tools and instructions of only the servers it uses, records the choice as an `mcp/servers` Session event, and hands it to its subagents. See [mcp-selection](packages/mcp/mcp-selection/README.md).
- **MCP tool calls ask first** — every call to an MCP server's tools asks the person unless its `toolPolicy` allows it, per tool or per server, and a server's stdio command starts with a minimal environment instead of inheriting the harness's own. See [tool-call policy](packages/mcp/mcp-client/README.md#tool-call-policy).
- **`web_fetch` host approval** — with `fetchApproval: ask` (the default), fetching a host outside `fetchAllowedHosts` asks first and shows the exact URL. See [tool-web](packages/web/tool-web/README.md).
- **Protected paths** — `protectedPaths` keeps SSH, cloud, container, and package-registry credential stores out of confined commands and refuses them to the sandboxed filesystem. See [sandbox-policy](packages/sandbox/sandbox-policy/README.md).
- **Credential redaction** — before a tool result is logged or sent to a model, every known credential value and well-known token format in it becomes `[redacted: <name>]`. See [secret-redaction](packages/guard/secret-redaction/README.md).
- **Session-log upload is opt-in** — the session log leaves the machine only when `@deepseek-ai/dsh-session-log-deepseek` sets `enabled: true`. See [session-log-deepseek](packages/session/session-log-deepseek/README.md).
- **Models settings** — a per-model default reasoning effort, request headers per provider route, and hand-declared models that reason at every selectable level. See [llm-pi-ai](packages/llm/llm-pi-ai/README.md) and [Models settings](packages/client/ui-settings-models/README.md).

## Run

### Run from `npm`

Install `Node.js`, then run:

```sh
npx @deepseek-ai/dsh web
```

The command starts the Web UI at `http://127.0.0.1:3080` by default and opens it in the default browser for a local launch. An SSH launch only prints the host URL because the SSH client or editor owns the local forwarded address. Pass `--no-open` to run the server without opening a browser. See [Web UI guide](docs/user/guide/index.md).

### Run from source

To run from a repository checkout:

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` prepares the repository artifacts. `pnpm dsh web` uses those built artifacts without rebuilding.

## Community and support

- Submit feedback or bug reports through [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions).
- Add the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic to your plugin repository for discoverability.
- Join <a href="https://discord.gg/4MrtZUhpxg">DeepSeek Harness Discord community</a>.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md).

`pnpm run dev:web` builds, serves, and rebuilds client bundles on source edits in one terminal, and `make help` lists the matching Make targets for Web and Desktop; the guide's application commands section owns the full table.

For agents, follow [AGENTS.md](AGENTS.md).

## Citation

```bibtex
@misc{deepseek-harness2026,
  title={DeepSeek Harness: Everything is a Plugin},
  author={DeepSeek-AI},
  year={2026},
  publisher={GitHub},
  howpublished={\url{https://github.com/deepseek-ai/deepseek-harness}},
}
```

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
