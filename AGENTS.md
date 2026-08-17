# Tooling

- Web dev server and build run through Wrangler (v4), driven via the `vinext` Cloudflare Vite plugin. The `npm run dev` / `build` / `start` scripts set `WRANGLER_LOG_PATH`; local Wrangler/Miniflare state lives in `.wrangler/` and is gitignored.

# Screen vocabulary

Use these names consistently in agent updates, plans, reviews, and PR descriptions:

- **Launch page:** the unauthenticated sign-in and preview entry page.
- **Workspace:** the main Hype PRs application after entering preview mode or connecting GitHub.
- **Triage queue:** the pull request list and its current view. Use **view** for a lens such as Needs attention or Recent activity, not screen.
- **Pull request detail:** the selected pull request's header, metadata, and actions.
- **Changed files:** the file tree beside the diff. Use **file browser** when referring to the interactive panel.
- **Diff viewer:** the code comparison area, including Split and Unified layouts.
- **Connection dialog:** the modal that explains and starts the GitHub connection.
- **Review dialog:** the modal for Comment, Approve, and Request changes.

Use **preview mode** for sample data and **live workspace** for connected GitHub data. Use **pull request** in prose and **PR** only in compact labels, IDs, or established product names.

# Pull requests

- Include screenshots in pull request descriptions to demonstrate the change. If a change has no user-visible effect, explicitly state that screenshots are not applicable.

# Commits

- AI models contributing to this repo must identify their model and harness in the commit message (e.g. an appended footer line such as `Created with: <harness> using <model>`).
