/* What the DEPLOYED page opens with: nothing.

   assets/ is kept out of the Vercel bundle (.vercelignore), so vercel.json
   rewrites /src/assets.js to this file. The page then starts on the placeholders
   without requesting four images that are not there - no 404s, no console
   errors - and visitors bring their own artwork through Upload.

   Locally nothing changes: src/assets.js is served as usual and the page opens
   on the real artwork. */
const ASSETS = [];
