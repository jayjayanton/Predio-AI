# PredioAI deployment

Current project demonstration: [jayjayanton.github.io/Predio-AI](https://jayjayanton.github.io/Predio-AI/).

Keep the existing Pages deployment for the preliminary project demonstration. Before operating a commercial application, use an appropriate application host: [GitHub Pages terms](https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features#pages) prohibit using Pages primarily to run an online business or commercial SaaS. Attaching a custom domain does not change those hosting terms. The migration below prepares a Render static frontend connected to the existing FastAPI service; it does not deploy or purchase anything automatically.

## 1. Reuse and verify the API

1. Reuse the existing Render web service. If no service exists, connect `jayjayanton/Predio-AI` using the repository's `render.yaml` Blueprint.
2. Record its exact public HTTPS origin, without a trailing slash. Open `<API_ORIGIN>/api/health` and confirm `status: ok` before building the frontend.
3. Set the backend's `CORS_ORIGINS` to the comma-separated **exact frontend origins** that need access. Retain `https://jayjayanton.github.io` for the current demo; add the actual Render frontend origin when available. Do not include paths, trailing slashes or spaces between entries. CORS configuration is not authentication or an upload-access policy.
4. Redeploy the API after an environment change and verify a browser lookup and document upload from each intended frontend origin. A healthy endpoint alone does not verify CORS or upstream municipal connectivity.

Render's [Free web services](https://render.com/docs/free) sleep after 15 minutes without inbound traffic; a new request can take about a minute to start them again. Check the API shortly before a demonstration and allow startup time. Render recommends Free compute for experimentation rather than production; review a paid API instance and usage costs before reliable commercial operation. The static frontend itself does not have this idle-sleep behavior.

## 2. Preserve the existing GitHub Pages demo

1. In repository **Settings → Pages**, use **GitHub Actions** as the source.
2. In **Settings → Secrets and variables → Actions → Variables**, set `VITE_API_URL` to the verified API origin. The existing Pages workflow supplies this value at build time.
3. Leave `VITE_BASE_PATH` unset. Production builds default to `/Predio-AI/`; local development defaults to `/`.
4. Run **Deploy PredioAI frontend to GitHub Pages**, or push the intended source state to `main`, then verify the deployed URL above.

## 3. Prepare a Render static frontend

In Render, select **New → Static Site**, connect this repository and configure:

| Setting | Value |
| --- | --- |
| Branch | `main` |
| Root directory | `frontend` |
| Build command | `npm ci --no-audit --no-fund && npm run build` |
| Publish directory | `dist` |
| `VITE_API_URL` | The verified existing API's public HTTPS origin |
| `VITE_BASE_PATH` | `/` |
| `SKIP_INSTALL_DEPS` | `true` (the build command installs dependencies) |

The build and publish paths are relative to the configured [root directory](https://render.com/docs/monorepo-support). This repository uses hash routes such as `/#planos`, so direct navigation does not currently require a catch-all rewrite. Add a history-routing fallback only if the routing architecture changes.

Use Render's assigned `onrender.com` URL for verification before connecting a purchased domain. [Static sites](https://render.com/docs/static-sites) have a free hosting option with bandwidth and build usage limits; check the current workspace allowances and [pricing](https://render.com/pricing). HTTPS is provided by the host. Keep FastAPI on its web service: a static site cannot run the Python backend.

`VITE_API_URL` and `VITE_BASE_PATH` are **build-time settings**. Changing them requires rebuilding and deploying the frontend. A backend environment change does not update an existing frontend bundle. [Vite exposes `VITE_*` values to browser code](https://vite.dev/guide/env-and-mode.html); do not put credentials in them.

## 4. Verify before a domain purchase or DNS change

1. Confirm CI passes for the intended commit. The existing Pages workflow and backend CI run separately; a frontend deployment is not evidence that backend tests passed.
2. At the assigned frontend URL, verify desktop and mobile navigation, a direct `/#planos` reload, property lookup, visible upload failures and a small authorized PDF/DXF inspection. Confirm assets load with no missing `/Predio-AI/` prefix or CORS failures.
3. Keep synthetic files explicitly labelled as interaction tests. Validate a real drawing against manually checked dimensions before presenting the measurement workflow as proven.
4. Check the chosen name for existing businesses and confirm the exact domain's current availability, initial term and renewal price with a registrar. An absent website or DNS response does not establish availability. Register only after the owner chooses the name and purchase terms.
5. Once the domain is owned, add it to the Render frontend, apply the DNS records shown for that exact service, and verify DNS and TLS using the [custom-domain guide](https://render.com/docs/custom-domains). Avoid copying DNS values from another deployment.
6. Add the actual HTTPS custom-domain origin to the API's `CORS_ORIGINS`, redeploy the API, and repeat lookup/upload checks on that domain. Preserve the working assigned URL while checking the new one.

The website remains a pilot: document parsing and interactive geometry do not establish verified measurements, construction permission or a completed technical report. Existing document processing is in memory; publishing the frontend does not add secure accounts, durable projects or team access controls.
