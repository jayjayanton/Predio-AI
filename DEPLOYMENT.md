# PredioAI public beta deployment

## 1. Render backend (free)
1. Connect the Render app/account and authorize access to this repository.
2. In Render, choose **New > Blueprint**, select `jayjayanton/Predio-AI`,
   and confirm the `render.yaml` service uses the **Free** instance.
3. Wait for the service to deploy. Open `https://YOUR-RENDER-SERVICE.onrender.com/api/health`
   and confirm it responds with `status: ok`.
4. The service may sleep after inactivity. The first request may take time.

## 2. GitHub Pages frontend
1. In GitHub repository Settings > Pages, choose **GitHub Actions** as the source.
2. Under Settings > Secrets and variables > Actions > Variables, create
   `VITE_API_URL` set to the **exact HTTPS origin** of the deployed Render API,
   without a trailing slash (example: `https://predioai-api.onrender.com`).
3. In Actions, run **Deploy PredioAI frontend to GitHub Pages** manually,
   or push a commit to main.
4. Open `https://jayjayanton.github.io/Predio-AI/`.
5. Test predio lookup and a small synthetic PDF/DXF upload. Do not upload
   confidential documents during the experimental public beta.

## 3. Deployment caveats
- The repository is private; GitHub Pages availability depends on plan and
  repository settings. A published Pages website may be publicly accessible.
- The Pages frontend alone cannot run FastAPI. A live backend URL is mandatory.
- The `VITE_API_URL` variable is baked into the frontend at build time.
  After changing it, redeploy the Pages workflow.
- Frontend builds can pass even if the Render API is not deployed.
- Free Render instances have memory, runtime, and idle restrictions.
- Do not market the geometry viewer as verified measurement or legal approval.
- The existing CI and this Pages workflow are separate. The Pages workflow
  builds the frontend; it does not automatically gate on backend pytest.
- Enable branch protections / required CI checks before treating deployment
  as a production release gate.
