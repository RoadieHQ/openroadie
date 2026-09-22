## Running on non-default ports

It can be useful to have multiple versions of the site running when you want to have two
agents working on it independently.

Defaults: frontend `3333`, backend `7008` (from `app-config.yaml`).

The frontend code reaches the backend with absolute URLs built from `backend.baseUrl` (not via the Vite `/api` proxy), so the frontend and backend each need to know the right ports. Three values need to agree:

| What                                                | Used by         | Override                         |
| --------------------------------------------------- | --------------- | -------------------------------- |
| Port the backend binds to                           | Backend         | `APP_CONFIG_backend_listen_port` |
| URL the frontend calls                              | Frontend (Vite) | `BACKEND_URL`                    |
| Origin the UI runs on (goes in the CORS allow-list) | Backend         | `APP_CONFIG_app_baseUrl`         |

### Backend

```bash
APP_CONFIG_backend_listen_port=7100 \
APP_CONFIG_backend_baseUrl=http://localhost:7100 \
APP_CONFIG_app_baseUrl=http://localhost:4444 \
env $(cat ./secrets.env | xargs) yarn start-backend
```

`APP_CONFIG_app_baseUrl` must match the frontend's origin — the CORS middleware merges it into the `backend.cors.origin` allow-list automatically.

### Frontend

`packages/app/vite.config.ts` reads two env vars:

- `PORT` — dev-server port
- `BACKEND_URL` — both the Vite `/api` proxy target **and** the `backend.baseUrl` the bundled client uses at runtime (injected via Vite `define`)

```bash
PORT=4444 BACKEND_URL=http://localhost:7100 yarn start-app
```

Both default to the standard ports when unset.

### Troubleshooting

- **Requests blocked by CORS**: the backend's `app.baseUrl` doesn't match the browser's origin. Set `APP_CONFIG_app_baseUrl=http://localhost:<frontend-port>` on the backend command.
- **Requests going to the wrong port (e.g. `:7008` when backend is on `:7100`)**: the frontend still has the default `backend.baseUrl`. Set `BACKEND_URL=http://localhost:<backend-port>` when running `yarn start-app` and fully restart the Vite dev server (the value is baked into the bundle via `define`, so HMR is not enough).
