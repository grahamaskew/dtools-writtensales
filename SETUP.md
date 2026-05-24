# D-Tools Report App — Setup Guide

Follow these steps in order to deploy the app.

---

## Step 1 — Create a Firebase Project

1. Go to [console.firebase.google.com](https://console.firebase.google.com) and sign in with your Google account.
2. Click **Add project** → give it a name (e.g. `dtools-report`) → click through the setup wizard.
3. Once created, click the **Web** icon (`</>`) to register a web app.
4. Give it a name (e.g. `dtools-report-web`) — do **not** enable Firebase Hosting.
5. Copy the `firebaseConfig` object that appears. You'll need it in Step 4.

---

## Step 2 — Enable Firebase Authentication

1. In the Firebase Console, go to **Build → Authentication → Get started**.
2. Under **Sign-in method**, enable **Email/Password**.
3. To create a user account for a company, go to the **Users** tab and click **Add user**.
   - Enter their email address and a temporary password.
   - They will enter their real password on first login (or you can send a password reset email from Firebase → Users → ⋮ → Send password reset email).

---

## Step 3 — Set Up Firestore Database

1. In the Firebase Console, go to **Build → Firestore Database → Create database**.
2. Choose **Start in production mode** → select a region close to your users → click **Enable**.
3. Once created, click **Rules** and replace the default rules with:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

4. Click **Publish**. These rules ensure each user can only read and write their own data.

---

## Step 4 — Configure the App

Open `js/config.js` and fill in your values:

```js
const APP_CONFIG = {
  firebase: {
    apiKey:            "...",   // from firebaseConfig
    authDomain:        "...",
    projectId:         "...",
    storageBucket:     "...",
    messagingSenderId: "...",
    appId:             "..."
  },
  workerUrl: "https://your-worker.your-subdomain.workers.dev",  // from Step 5
  useMock:   true,   // keep true until real API access is available
  appName:    "D-Tools Report",
  appSubtitle: "Approved Estimates",
  appCategory: "Estimating Tool"
};
```

---

## Step 5 — Deploy the Cloudflare Worker

1. Sign up at [cloudflare.com](https://cloudflare.com) (free account is sufficient).
2. Go to **Workers & Pages → Create application → Create Worker**.
3. Give it a name (e.g. `dtools-proxy`).
4. Click **Edit code**, delete the default code, and paste the entire contents of `cloudflare-worker.js`.
5. In the worker code, update `ALLOWED_ORIGINS` with your GitHub Pages URL:
   ```js
   const ALLOWED_ORIGINS = [
     'https://YOUR-GITHUB-USERNAME.github.io',
     'http://localhost:5500',
     'http://127.0.0.1:5500'
   ];
   ```
6. Click **Save and Deploy**. Copy the worker URL (e.g. `https://dtools-proxy.yourname.workers.dev`) and paste it into `js/config.js` → `workerUrl`.

---

## Step 6 — Deploy to GitHub Pages

1. Create a new repository on GitHub (e.g. `dtools-report`).
2. Push all files to the repository (the root should contain `index.html`, `app.html`, `setup.html`, etc.).
3. Go to the repository **Settings → Pages**.
4. Under **Source**, select **Deploy from a branch** → branch: `main` → folder: `/ (root)`.
5. Click **Save**. After a minute, your app will be live at:
   `https://YOUR-GITHUB-USERNAME.github.io/dtools-report/`

---

## Step 7 — Test with Mock Data

With `useMock: true` in `config.js`, no D-Tools API connection is needed.

1. Open `index.html` in a browser (or via GitHub Pages).
2. Sign in with a Firebase user you created in Step 2.
3. On the Setup page, select **D-Tools SI** or **Cloud**, enter any text as an API key (mock mode ignores it), and click **Save & Continue**.
4. On the Search page, enter:
   - **Start Date:** 2026-01-01
   - **End Date:** 2026-03-31
5. Click **Search**.

**Expected results:**

| Client | Records | Subtotal |
|--------|---------|----------|
| Anderson Residence | 2 (1 estimate + 1 CO) | $53,700.00 |
| Baxter Commercial | 1 (estimate) | $32,750.00 |
| Heritage Hotel | 2 (1 estimate + 1 CO) | $146,300.00 |
| **Grand Total** | **5** | **$232,750.00** |

**To verify filtering:** Try a date range that does NOT include Jan–Mar 2026 (e.g. Jun–Sep 2025) — the result should be empty, confirming the noise records are excluded.

---

## Step 8 — Switch to Live API (when access is available)

1. Open `js/config.js` and set `useMock: false`.
2. Each user will need to enter their real D-Tools API key on the Setup page.
3. The Cloudflare Worker forwards all requests to D-Tools with the correct auth header:
   - **D-Tools SI:** `X-DTSI-ApiKey`
   - **D-Tools Cloud:** `X-API-Key`

### Field names to verify against the live API

The following field names are assumed based on D-Tools API documentation and need to be confirmed against actual responses:

| Assumed field (SI) | Meaning |
|--------------------|---------|
| `Progress` | Project status (expected value: `"Approved"`) |
| `ProgressChangedDate` | Date the status changed |
| `TotalPrice` | Sell total for the estimate |
| `ClientName` | Client / customer name |
| `IsChangeOrder` | Boolean — true if this is a change order |
| `ChangeOrderNumber` | CO number (integer or null) |

For D-Tools Cloud, the equivalent fields are in `js/api.js` under `_cloudGetApprovedEstimates()` and the `_normalise()` method — update as needed once field names are confirmed.

---

## File Structure

```
dtools-report-app/
├── index.html              Login page
├── setup.html              API configuration (first login + settings)
├── app.html                Search & results page
├── css/
│   └── style.css           Shared styles (design system)
├── js/
│   ├── config.js           Firebase + Cloudflare config (edit this)
│   ├── mock-data.js        Mock test data (10 records, 5 noise)
│   └── api.js              D-Tools API client + helpers
└── cloudflare-worker.js    Cloudflare Worker proxy script
```
