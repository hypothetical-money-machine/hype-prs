# Tooling

- Web dev server and build run through Wrangler (v4), driven via the `vinext` Cloudflare Vite plugin. The `npm run dev` / `build` / `start` scripts set `WRANGLER_LOG_PATH`; local Wrangler/Miniflare state lives in `.wrangler/` and is gitignored.

# Pull requests

- Include screenshots in pull request descriptions to demonstrate the change. If a change has no user-visible effect, explicitly state that screenshots are not applicable.

# Commits

- AI models contributing to this repo must identify their model and harness in the commit message (e.g. an appended footer line such as `Created with: <harness> using <model>`).
