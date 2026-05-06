# ADR 0013 - INFRA-2 subdomain split (api + web at one domain)

**Status:** Accepted
**Date:** 2026-05-06 (same-day follow-up to INFRA-1)
**Context window:** Slice INFRA-2
**Builds on:** [ADR 0012 - INFRA-1 self-hosted runtime bundle](0012-infra-1-self-hosted-bundle.md)

## Context

After INFRA-1 shipped, the entire `modern-mage.com` apex was routed through the Cloudflare Tunnel to the local WebApi. Two surfaces hit it:

1. **Friends sharing the playtest URL** were given `https://xmage-playtest.vercel.app/` (Vercel default URL) - functional but not memorable.
2. **Anyone typing `modern-mage.com` directly** got JSON from the auth middleware ("MISSING_TOKEN: Authorization: Bearer required") - confusing.

The user wanted `modern-mage.com` to feel like a real product URL: type it, get the React app. The Vercel default URL stays available as a backup but is no longer the primary share link.

## Decision

Split the domain by subdomain:

| URL | Hosted by | Purpose |
| --- | --- | --- |
| `modern-mage.com` (apex) | Vercel | React app (web client) |
| `api.modern-mage.com` | Cloudflare Tunnel -> local JVM | API + WebSocket |
| `xmage-playtest.vercel.app` | Vercel (still works) | Backup web app URL |

### Sub-decisions

#### D1 - Subdomain split, not path split

Path-split (e.g. `modern-mage.com/api/*` -> tunnel, everything else -> Vercel) was considered. Rejected because Vercel doesn't proxy a path subset to an external origin without serverless-function indirection, and Cloudflare-side routing rules would re-introduce a maintenance surface we just simplified away.

Subdomain split is the cleaner architectural shape: one DNS record per service, each provider handles one hostname end-to-end.

#### D2 - Apex on Vercel (gray cloud), API on tunnel (orange cloud)

The Cloudflare proxy state is load-bearing for both records and the failure modes are distinct:

- **Apex CNAME proxied through Cloudflare (orange cloud)** -> Vercel SSL provisioning fails because Cloudflare intercepts the HTTP-01 challenge. WebSocket and HTTP/3 also become unreliable through the double layer. Vercel's docs explicitly say "DNS only" for their custom domains.
- **Tunnel CNAME with proxy disabled (gray cloud)** -> the underlying `<uuid>.cfargotunnel.com` target is meaningless without Cloudflare's proxy. Resolution returns a private IPv6 ULA in the `fd10::/8` range and TCP fails.

This was caught live during INFRA-2 Phase B: the user editing the apex DNS in Cloudflare's dashboard accidentally toggled `api.modern-mage.com` to "DNS only" too, and the API endpoint went unreachable. Fix was a single-click flip back to orange. Documented in `reference_cloudflare_tunnel_gotchas.md` (memory) and in the cloudflared-config template comments.

#### D3 - Phase A then Phase B sequencing

Two-phase rollout for safety:

- **Phase A (additive, fully reversible):** Add `api.modern-mage.com` ingress to cloudflared-config.yml alongside the existing apex entry; create the api DNS CNAME via `cloudflared tunnel route dns --overwrite-dns`; restart MageTunnel; update Vercel env var `VITE_XMAGE_WEBAPI_URL` -> `https://api.modern-mage.com`; redeploy Vercel. The live app keeps working through both apex and api during this phase.
- **Phase B (cutover, dashboard-driven):** Add `modern-mage.com` to the Vercel project as a custom domain; in Cloudflare, change apex DNS from tunnel-CNAME (orange) to Vercel A-records (gray). Wait for SSL provisioning. Cutover happens in the DNS-propagation window; rollback (if needed) is just reverting the apex DNS to tunnel-CNAME.

If anything had gone wrong in Phase B, Phase A's state was self-sufficient: the live app at xmage-playtest.vercel.app would have continued working using `api.modern-mage.com` without any further intervention.

#### D4 - CORS already permissive enough

The pre-existing `corsOrigins` in `config.json` already included `https://modern-mage.com`, which is the Origin sent by the Vercel-hosted app at the apex. No CORS update was needed during INFRA-2 - the WebApi just kept accepting the same allow-list. Future addition of `https://api.modern-mage.com` to corsOrigins is unnecessary because that hostname is the API itself, not a calling Origin.

## Consequences

### Positive

- **Friends can share `modern-mage.com`** as a single memorable URL.
- **API surface is isolated** - changes to the web app deploy through Vercel; changes to the API deploy through `mage-redeploy.ps1`. Clean separation.
- **Multi-hostname tunneling pattern proven** - if a future product surface needs another tunnel-routed endpoint (e.g., `admin.modern-mage.com`), the cloudflared ingress + DNS pattern is already established.

### Negative

- **One more moving part for new contributors to understand** (orange-vs-gray Cloudflare proxy state). Mitigated by inline comments in `cloudflared-config.yml.template` and the dedicated reference memory.
- **Vercel free tier WAF/bot protection is weaker** than Cloudflare's free tier. The web app is now defended by Vercel only, not Cloudflare-proxied. Acceptable because the web app is mostly static (React bundle) and DDoS risk on static is naturally low.

### Future directions

- **API failure isolation:** if the local JVM goes down, `api.modern-mage.com` returns errors but `modern-mage.com` (web app) still loads from Vercel - the React app will show a clean "can't connect" state rather than a totally-dead page. Better UX than the pre-INFRA-2 setup where everything went down together.
- **Cloudflare Pro upgrade** ($20/mo) would unlock advanced WAF on the API tunnel - reasonable if/when the user goes public with this service.
- **Route DNS automation:** `cloudflared tunnel route dns` is fine for 1-2 hostnames. For more, a Cloudflare API token + Terraform/script would scale better.

## Implementation reference

- Cloudflared config: [`mage-stack/config/cloudflared-config.yml`](../../mage-stack/config/cloudflared-config.yml) + [`.template`](../../mage-stack/config/cloudflared-config.yml.template)
- README architecture diagram: [`mage-stack/README.md`](../../mage-stack/README.md) "Public URL architecture (post-INFRA-2)" section
- Critic-pass row: [`docs/decisions/critic-pass-log.md`](critic-pass-log.md) under "INFRA-2 (2026-05-06, ...)"
- Memory: `reference_cloudflare_tunnel_gotchas.md` (proxy state matrix added)
