# Kitchenbinder branding

The production assets are in `apps/web/public/branding/`:

- `logo-horizontal.png`, transparent 2172 by 724 wordmark used in recipe PDFs.
- `share-1200x630.png`, wide social preview matching the Open Graph dimensions.
- `share-1080x1080.png`, square social artwork.

The built-in `image_gen` tool replaced the Prep Sheet lettering in the existing
artwork with Kitchenbinder. The recipe-and-knife symbol, palette and tagline were
retained. The full prompt set is recorded in [prompts.json](prompts.json).
The social outputs were resampled to the existing export dimensions. The
horizontal logo retains its transparent background.

The existing favicon, app icons and Apple touch icon contain only the symbol and
remain unchanged. The extension copies those icons from the website at build
time. UI wordmarks remain text in the website and popup components.

`output/branding/recipe-knife-v1/` and the original branding ZIP are historical
Prep Sheet exports. They are not production asset sources for Kitchenbinder.
