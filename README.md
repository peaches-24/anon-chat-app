# Anonymous Chat App

A lightweight anonymous chat app with a public user chat page and a protected admin dashboard.

## Local Run

1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the server:
   ```bash
   node server.js
   ```
3. Visit:
   - User chat: `http://localhost:3000/`
   - Admin dashboard: `http://localhost:3000/admin-secret-access-xyz?key=mySecretPassword`

## Render Deployment

### Start Command
Use:
```bash
node server.js
```

### Environment Variables
Set these in Render's dashboard under Environment:

- `ADMIN_ROUTE` - the secret admin path, e.g. `/admin-secret-access-xyz`
- `ADMIN_KEY` - the query key required to access the admin page, e.g. `mySecretPassword`

Then access the admin dashboard at:
```text
https://your-render-url.com<ADMIN_ROUTE>?key=<ADMIN_KEY>
```

## Notes

- The root path `/` serves the public chat app.
- `/admin.html` and `/admin` are blocked and return `404`.
- `/threads` returns thread data used by the app.
