# Nenova Desktop

Windows desktop shell for https://nenovaweb.com. No ERP server, database driver, credentials, or copied ERP data are bundled. See [PRD](../docs/desktop/PRD.md), [security](../docs/desktop/SECURITY.md), [user guide](../docs/desktop/USER_GUIDE.md).

Requires Node 24 and Windows x64 for installer validation.

```powershell
cd desktop
npm ci
npm run menu
npm test
npm run test:smoke
npm run test:restore
npm start
npm run dist
```

`dist/Nenova-Desktop-Setup-1.3.0-x64.exe` is the NSIS installer. Signing requires a separately provisioned publisher certificate; this initial build is unsigned. CI retains installer artifacts and SHA256 for 30 days, without publishing or auto-installing releases.

The shell uses sandboxed WebContentsView instances with no remote preload. Reparenting retains live pages. Only an authenticated same-account metadata snapshot is restored, with URL query allowlisting and Windows safeStorage encryption. Packaged builds enable cookie encryption. Desktop never replays ERP writes.

At login, /api/desktop/bootstrap supplies every menu permitted for the authenticated account directly from components/Layout.js. Web deployments and new menus synchronize without reinstalling. Existing edited tabs remain open; save and refresh them to load updated page code. Version 1.0 users must install 1.1 once. Desktop binary updates still require a new installer. See docs/desktop/LOGIN_SYNC.md.

Smoke tests intercept the entire HTTPS session and isolate userData/sessionData profiles. They send no requests to production. Restore tests use two Electron processes. Tests and development files are excluded from the installer.

Version 1.2 defaults to a 44px tab strip. Tools (Ctrl+Shift+B) restore desktop controls and web navigation without reloading. The NenovaDesktop user-agent token is a presentation hint only.
