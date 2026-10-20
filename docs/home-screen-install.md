# Home-screen installation

On mobile, choose **Account > Add to home screen**. When the browser has offered
an install event, this opens its native confirmation. Otherwise it opens a short
guide for iPhone/iPad, Android or other browsers. iOS uses the browser's Share
menu; the site cannot open Apple's installation screen itself.

A small suggestion appears on a return visit in a new browser tab/session, not
on the first visit or its reloads. Dismissing it, opening the guide or attempting
installation suppresses the suggestion for 30 days. The Account entry remains
available. Storage failure suppresses the suggestion without blocking the guide.
Controls disappear while running as an installed app, after an `appinstalled`
event, or after accepting the native prompt in the current page. Acceptance is
not shown as a claim that installation finished. No offline caching is added.

## Android local testing

The development server can be reached on your network with
`pnpm --filter web dev --host 0.0.0.0`. Plain HTTP at a LAN IP can show the guide
but does not meet the secure-origin requirement for normal app installation.

For an actual installation test without deploying, connect Android by USB,
enable USB debugging and accept your computer on the phone. In desktop Chrome,
open `chrome://inspect/#devices`, choose **Port forwarding**, and forward device
port `3001` to `localhost:3001`. Keep the computer's development server running,
then open `http://localhost:3001` in Chrome on the phone. Localhost is treated as
a secure origin. You can also use an existing trusted HTTPS development origin.
Do not bypass certificate warnings or disable browser security.
See [Chrome's port-forwarding instructions](https://developer.chrome.com/docs/devtools/remote-debugging/local-server).

1. Open Account and choose Add to home screen.
2. Confirm the native prompt if offered, or follow the browser-menu guide.
3. Launch Kitchenbinder from the new icon. Check the name, icon, standalone
   window and that install controls are hidden.
4. Close and reopen it. Installation does not add offline access, and signing
   in may still be required in the installed app.
5. Check dismissal, reopening the guide from Account and browser Back/Escape
   closing the guide. A dismissed native event cannot be reused; a new event
   from the browser restores native installation.

## iPhone preview

Use an iPhone-sized viewport and override the user agent to iPhone Safari before
loading the page. The production Account entry then opens the actual iOS guide.
To preview the optional suggestion in a separate disposable browser profile,
set session storage `kitchenbinder:install:visit` to `returning` and reload.
Remove `kitchenbinder:install:dismissed-until` from local storage if previously
dismissed. These values affect only suggestion timing, not account data.

This checks our responsive layout and guide interaction in Chromium. It does
not emulate Safari's Share sheet or verify installation, cookies or standalone
behaviour on a real iPhone. Apple TestFlight is unnecessary for this web preview.
