# Etsy marketplace adapter

Pod Automator uses Etsy Open API v3 and OAuth 2.0 authorization-code flow with mandatory S256 PKCE. It requests only `listings_r listings_w shops_r`. Tokens and PKCE verifiers are encrypted with AES-256-GCM and workspace/provider associated data; OAuth state is stored only as a hash and is single-use.

## Etsy app registration

1. Create an Etsy developer app and wait for Etsy approval.
2. Set `ETSY_KEYSTRING` and `ETSY_SHARED_SECRET` on the API and worker.
3. Generate `MARKETPLACE_TOKEN_ENCRYPTION_KEY` with `openssl rand -base64 32`.
4. Register `ETSY_REDIRECT_URI`. In production it must be HTTPS and must match exactly, including case and path: `https://your-api.example/api/marketplaces/etsy/oauth/callback`.
5. Restart the API and worker, then connect the shop from Connections.

Production-partner disclosure must be configured directly in Etsy before publishing POD products.

## Listing lifecycle

An Etsy destination does not require credentials during workflow execution. The worker creates a local `preview` with editable copy, commercial fields, and ordered mockup IDs. External actions are explicit:

`preview → syncing → draft → publishing → published`

Failures record `failedStage` and a bounded Etsy error. Draft sync reuses `externalId`; the ID is persisted before image uploads to prevent duplicates if an upload retry follows listing creation. Publishing requires an explicit confirmation warning that Etsy may charge an activation/listing fee.

The marketplace BullMQ queue handles draft uploads and publication independently from workflow jobs. Etsy 429 responses honor `retry-after`; transient 5xx/network failures use bounded exponential retries; validation and other 4xx responses are not retried.

V1 supports physical products and one offering/SKU per listing. Variations, digital products, orders, fulfillment sync, and production-profile creation are intentionally out of scope.
