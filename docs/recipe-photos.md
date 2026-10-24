# Recipe photos

Imported recipes get a cover photo copied from the source page. Recipes without
one (pasted text, generated recipes, pages without photos) keep the tinted
placeholder cover. There are no user uploads and no backfill of existing recipes.

## How a photo is chosen

1. Candidates are collected without AI: the Recipe JSON-LD `image`, then
   `og:image`/`twitter:image`, then up to eight large `<img>` elements in
   `article`/`main` (website imports) or the recipe card (extension captures).
   At most ten, http(s) only, no credentials, no SVG or `data:` URLs.
2. If the recipe metadata has an image, the first one is used. The AI is not asked.
3. Otherwise the remaining candidates (URL, alt text, source) are appended to the
   AI input and the model returns `imageIndex` or null.
4. Generated recipes never get a photo.

Candidates are kept on `recipe_import.image_candidates` only until generation
finishes. The chosen URL is kept in the checkpoint until the recipe is saved.

## Copying

After the recipe is saved, the worker:

- fetches the image with the page fetcher's protections: public addresses only,
  pinned DNS, at most three redirects, `image/*` only, 10 MB, 10 seconds. It sends
  the recipe page as `Referer`.
- re-encodes it with sharp: JPEG/PNG/WebP/GIF/HEIF only, 40 MP limit, first frame
  only, EXIF orientation applied, all metadata (including GPS) dropped.
- writes `recipes/<recipeId>/<uuid>-480.webp` and `-1200.webp` (never enlarged)
  with `Cache-Control: public, max-age=31536000, immutable`.
- stores `{ key, url, width, height, color }` in `recipe.photo`.

Photo failures are logged (`import_photo_failed`) and never fail the import.
`sharp` is only loaded by the worker. The web server bundle must not import
`packages/api/src/recipes/media.ts` eagerly.

Copies of a recipe share the original's objects. Edits never change the photo.

## Cleanup

The worker sweeps the bucket every six hours and deletes objects older than a day
whose key no `recipe.photo` references. This covers every way a recipe row is
removed (account deletion, household deletion, expired soft deletes). Soft-deleted
recipes keep their photo until the row is gone.

## Lightsail setup

1. Create a Lightsail bucket in the host's region. Set **Access permissions** to
   *Public (read-only)* for all objects.
2. Create a bucket access key. Put the key ID and secret in
   `MEDIA_ACCESS_KEY_ID` and `MEDIA_SECRET_ACCESS_KEY`.
3. Create a Lightsail distribution with the bucket as origin, using the
   *Cache everything* preset (objects are immutable).
4. Add a custom domain to the distribution, e.g. `media.kitchenbinder.app`:
   create the Lightsail certificate, add its validation CNAME in Cloudflare
   (DNS only), then add a DNS-only CNAME from `media` to the distribution
   hostname.
5. Set in `/etc/prep-sheet/runtime.env`:

   ```sh
   MEDIA_BUCKET=<bucket name>
   MEDIA_REGION=<bucket region, e.g. ap-southeast-2>
   MEDIA_ACCESS_KEY_ID=<key id>
   MEDIA_SECRET_ACCESS_KEY='<secret>'
   MEDIA_PUBLIC_URL=https://media.kitchenbinder.app
   ```

   Without the custom domain, `MEDIA_PUBLIC_URL` can be the distribution's default
   `https://<id>.cloudfront.net` hostname, or the bucket URL with no CDN.

6. Run `pnpm db:migrate` (0009 adds `recipe.photo`) before deploying the release.

If any of the five values is blank, photo copying and the sweep are skipped.
`MEDIA_PUBLIC_URL` is baked into stored photo URLs. Changing it later needs a
`recipe.photo` URL rewrite.

## Release order

The extension sends `images` with captures. The server must be deployed before
an extension build that sends them, because older servers reject unknown fields.

## Local development

Leave the `MEDIA_*` values blank, or point them at MinIO with
`MEDIA_ENDPOINT=http://localhost:9000` (path-style requests are used when an
endpoint is set).
