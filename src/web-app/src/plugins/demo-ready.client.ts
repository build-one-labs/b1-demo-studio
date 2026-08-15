/**
 * Marks the app shell as ready for the demo factory's recorder.
 *
 * `src/app-server-ts/demo-factory/src/lib/record.mjs` waits for `[data-demo-id="app-ready"]`
 * before every take and, when it never appears, swallows the failure and
 * records a 15-second timeout into the start of each clip.
 *
 * Upstream the marker is written straight into the framework's `main` layout.
 * Here the framework arrives as the published `@buildone/web-framework-layer`,
 * so the app stamps it on instead: copying the layout into this repo just to
 * add one attribute would fork 45 lines the app has no other reason to own, and
 * `data-demo-id` is a recording concern rather than a layout one.
 *
 * `app:mounted` fires once per page load, which is the same moment the upstream
 * layout would have painted the marker. Every scene records in a fresh browser
 * context, so the hook runs again for each take.
 */
const READY_DEADLINE_MS = 5_000;

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.hook('app:mounted', () => {
    // Only ever the app shell — never a body fallback. Upstream's marker lives
    // inside the `main` layout, so it is absent on /sign-in, and a recorder
    // that treated the login page as "ready" would film the login page. The
    // poll covers the shell mounting a tick after the Nuxt app itself.
    const deadline = Date.now() + READY_DEADLINE_MS;
    const stamp = () => {
      const shell = document.querySelector('.b1-shell-row');
      if (shell) {
        shell.setAttribute('data-demo-id', 'app-ready');
        return;
      }
      if (Date.now() < deadline) requestAnimationFrame(stamp);
    };
    stamp();
  });
});
