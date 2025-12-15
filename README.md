# Edge Image Transformer

An Edge function built with [Hono](https://hono.dev/) and [jSquash](https://github.com/jamsinclair/jSquash) for on-demand image resizing and metadata retrieval.

## Routes

### `GET /?url=<image_url>&width=<width>&height=<height>&format=<format>`

- `url` (required): Absolute URL of the source image.
- `width`, `height` (optional): Desired output dimensions.
  - Supply one or both values to resize while preserving the source aspect ratio.
  - If neither is provided, the original image is returned unchanged.
- `format` (optional): Desired output format (e.g., `jpeg`, `png`, `webp`, `avif`). If not specified, the source format is preserved.

Returns: The transformed image encoded in the requested format when provided, otherwise the source format. The `Content-Type` mirrors the output.

### `GET /meta/?url=<image_url>`

Returns JSON:

```json
{
  "width": <number>,
  "height": <number>,
  "thumbHash": "<base64>"
}
```

- `thumbHash` is a [ThumbHash](https://github.com/evanw/thumbhash) placeholder that can be rendered on the client for a quick preview.

## Local Development

```bash
pnpm install
pnpm dev
```

- `pnpm dev` runs Vite with the Cloudflare Workers dev server adapter.

## Build & Deploy

```bash
pnpm build   # Emits dist/worker_image_transformations
pnpm deploy  # Builds and deploys via Wrangler
```

## Cloudflare Type Synchronisation

Whenever `wrangler.jsonc` changes, refresh the generated bindings:

```bash
pnpm cf-typegen
```

This command updates the `CloudflareBindings` type so that Hono routes have accurate autocompletion.
