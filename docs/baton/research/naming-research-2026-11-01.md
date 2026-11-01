# Baton rename: domains, prices and trademark screen

retrieved_at: 2026-11-01 (all times about 14:15-14:30 UTC)
serves: Baton (open-source voice assistant and agent session manager). Not a VentureOS pack.
decision: which name and domain to hold for a possible rename. Nothing was bought, registered or submitted.
status: trademark screen is PARTIAL. No official register answered from this box. This is a screen, not legal advice.

## Answer

| Rank | Name | Say it | Buy | Yearly cost | Main risk |
|---|---|---|---|---|---|
| 1 | Tramoka | tra-MOH-ka | tramoka.com | $11.62 at Dynadot, $11.81 at Porkbun, same on renewal | Link to weaving is indirect (Latin/Italian trama = weft). Official registers unchecked. x.com/tramoka returned 200, meaning unclear. |
| 2 | Filara | fi-LAH-ra | filara.ai | $165.40 minimum for 2 years at Porkbun ($82.70/yr), .ai renewal in 2-year units | No .com, .app, .dev, .org, .co. Same name already used by several apps, one a design app about stitching. |
| 3 | Weavia | WEE-vee-a | weavia.ai ($165.40 for 2 years) or weavia.app ($8.00 first year, $14.50 renewal at Dynadot) | as shown | Close to WEAVIATE, a live US registration for AI database software. Worst legal fit of the three. weavia.com held since 2004. |

Reserve: Skeinora (SKAY-nor-a), every checked TLD free, but "skein" is often misread as "skine", which hurts spelling and a wake word.

Recommendation: Tramoka with tramoka.com, about $12 a year. It is the only one of the top three with a clean .com, and its T, M and K give a wake word more distinct sounds than Filara. If he prefers Filara, buy filara.ai and accept no .com and the app overlap. Have an official-register search done before committing to any name.

weavia.com on 2026-11-10: not a real opening. See the section below.

## Method

Domain status comes from registry RDAP by curl, not the `whois` command: same registry data, machine-readable. HTTP 200 = registered, 404 = no record at the registry. Controls: github.io 200, github.co 200, google.ai 200, nic.so 200. RDAP does not show premium pricing, so "free" below means unregistered at the registry, and the checkout price of each is unconfirmed.

175 pronounceable names were screened on .com. Of the first 110, mostly short, only loimara.com and tantova.com were unregistered; neither was shortlisted. Of the 65 longer names tried next, 23 had a free .com. Eight were shortlisted for sound and meaning.

Free .com, not shortlisted: weftika, weftari, weftivo, weaviro, filarix, filaveo, filakai, warpika, warpara, skeinara, threadika, twinika, selvoka, kudava, loimika.

## Domain status (registry RDAP, 2026-11-01)

T = taken, F = free (unregistered at registry).

| Name | .com | .net | .org | .app | .dev | .io | .ai | .co | .so |
|---|---|---|---|---|---|---|---|---|---|
| filara | T | F | T | T | T | F | F | T | F |
| weavia | T | T | F | F | F | T | F | F | F |
| tramoka | F | F | F | F | F | F | F | F | F |
| tramavo | F | F | F | F | F | F | F | F | F |
| skeinora | F | F | F | F | F | F | F | F | F |
| skeinova | F | F | F | F | F | F | F | F | F |
| weftana | F | F | F | F | F | F | F | F | F |
| weftaro | F | F | F | F | F | F | F | F | F |
| tessoka | F | F | F | F | F | F | F | F | F |
| weavika | F | F | F | F | F | F | F | F | F |

Held-domain detail:
- filara.com: registered 2000-06-16, expires 2027-06-16, registrar Ascio, nameservers dns.intendo.it and dns2.intendo.it, status active, no A record. No asking price found.
- weavia.com: see below. No asking price found.
- filara.co: registered 2026-07-10, expires 2028-07-10. Recently taken by someone.
- weavia.io: registered, Cloudflare nameservers, did not resolve to a site.

Asking prices: not established. Afternic returned 404 for both names, dan.com redirected to the Afternic home page, and Sedo served a script shell with no price visible to curl.

## weavia.com expiry

Verbatim from Verisign and registrar RDAP, 2026-11-01:

> "registration","eventDate":"2004-11-10T21:00:32Z"
> "expiration","eventDate":"2026-11-10T21:00:32Z"
> "last changed","eventDate":"2025-11-25T09:35:29Z"
> "status":["client transfer prohibited"]
> "fn","Moniker Online Services LLC"; NS0.NETBENEFIT.CO.UK, NS1.NETBENEFIT.CO.UK

Reading (inferred): held 22 years. The last change came 15 days after the 2025 expiry date, which fits a renewal inside the grace period, so the date passing proves nothing. DNS currently fails at delegation (dns.google status 2), so the name is unused, but that is not evidence of abandonment. Even if not renewed, secondary sources give about 45 days grace, 30 redemption and 5 pending delete, so the earliest drop is around 2027-01-29, and an old short .com attracts drop-catchers. Check RDAP after 2026-11-10 and again in late January.

## Prices (same day, USD, standard non-premium)

Sources: Porkbun raw table https://porkbun.com/products/domains and https://porkbun.com/tld/ai. Dynadot raw https://www.dynadot.com/domain/tlds, /domain/ai, /domain/app, /domain/dev. Namecheap and NameSilo returned 403. Cloudflare's own page says at cost but shows no table to curl.

| TLD | Porkbun first / renew | Dynadot first / renew | Note |
|---|---|---|---|
| .com | $11.81 / $11.81 | $11.62 / $11.62 | best value |
| .net | $12.52 / $12.52 | $12.52 / $12.52 | |
| .org | $7.98 / $11.84 | $7.99 / $11.64 | |
| .app | $8.75 / $14.93 | $8.00 / $14.50 | |
| .dev | $8.75 / $12.87 | EUR 7.32 / EUR 11.44 (page served in euros) | |
| .co | $15.76 / $31.20 | $15.50 / $31.20 | renewal doubles |
| .io | $28.12 / $51.80 | $28.89 / $53.50 | renewal nearly doubles |
| .ai | $82.70 / $82.70 per year, 2-year minimum, so $165.40 | $85.60 / $85.60 listed per year | see contradiction C1 |
| .so | not shown | not shown | price unknown |
| .sh | $31.20 / $46.65 | not read | |

Verbatim, Porkbun /tld/ai: "Note: .AI Domains require a minimum term of 2 years for registration and renewals. .AI transfers include a 2 year renewal."

Secondary, CostGoat (https://costgoat.com/compare/domains/ai and /com): .ai cheapest "$80.00/year at Cloudflare", "No 1-year option"; .com wholesale "rises from $10.26 to" $10.97 "on November 1, 2026". That is today, so its older table figures may be stale. Cloudflare .com was listed at $10.46 and is likely higher now. Re-check at purchase.

## Trademark screen, classes 9 and 42

Registers actually checked: none of the official ones.

| Register | Result from this box |
|---|---|
| USPTO tmsearch | page loads; search endpoint returned 403, AWS WAF challenge |
| UK IPO tmtext | 403, security check captcha |
| TMview (covers UK, EU, US data) | "Request Rejected" |
| EUIPO eSearch | connection reset |
| WIPO Global Brand Database | Altcha challenge |
| Justia, uspto.report | 403 |

The onnyx route was not used: this agent's Bash is limited to curl fetches. Captchas were not solved.

Secondary source used: Trademarkia, US filter only, exact-word search, https://www.trademarkia.com/search/trademarks?query=NAME. Controls worked: nike 170, weaviate 1. Prefix results: only page 1 read, 20 rows each (filar* 23 total, weavi* 65, skein* 18).

| Name | US exact | Near matches seen |
|---|---|---|
| Filara | 0 (filaro, fylara 0) | filar*: FILAROID 88188165 class 9 dead/abandoned. No live 9/42 on page 1. FILAROLA, FILARE are live in unrelated classes. |
| Weavia | 0 (weavea, wevia 0) | WEAVIATE, Weaviate B.V., 79325996, filed 2021-08-25, "Live/Registered on 02 May 2023", class 9 plus services, "Design, development and maintenance of database software". WEAVING THE FUTURE, Woven by Toyota, 79419684, live, classes 9 and 42. |
| Tramoka | 0 (trameka 0, tram*ka 0) | TRAMAKO 88540337 class 9, "Dead/Cancelled on 21 Aug 2026". |
| Tramavo | 0 | none searched further |
| Skeinora, Skeinova | 0 | SKEIN, Skein Labs Inc., 99469384, "Live/Pending on 16 Jun 2026", classes 5, 9. Different spelling length but shares the stem. |
| Weftana, Weftaro | 0 | wefta* 0 |
| Tessoka, Weavika | 0 | not searched further |

Zero on Trademarkia is not clearance: it is US only, excludes UK, EU and unregistered rights, and exact-word.

## Other namespaces

| Name | GitHub | npm | PyPI | App Store (GB) | Google Play | YouTube | Bluesky | X | TikTok |
|---|---|---|---|---|---|---|---|---|---|
| filara | taken: user, 1 repo, 2016 | free | free | taken: FILARA (Adev LLC, shopping), Filara (YUNG WKND LLC, Graphics & Design) | Filara (Art & Design), FILARA FITNESS | taken: title "Jose Moreno" | no record | 200 | 200 |
| weavia | free | free | free | no exact title | no exact title seen | free | no record | 404 | 200 |
| tramoka | free | free | free | no exact title | no exact title seen | free | no record | 200 | 200 |
| skeinora | free | free | free | no exact title | no exact title seen | free | no record | 404 | 200 |

X and TikTok status codes are unreliable: both can serve 200 for a missing page. Treat X 404 as probably free, and every 200 as unknown. Reddit returned 403 for all. Instagram not checked. tessoka on GitHub is taken; the other shortlisted names are free. All ten are free on npm and PyPI.

Filara App Store verbatim: "Filara is embroidery made with code. I write programs that draw a design one stitch at a t" (cut by the query).

UK Companies House search: no filara, tramoka or skeinora match on the results page; weavia returned only WE AVIATE LTD.

## Claims

Origin taxonomy: all `market-research` unless stated. Confidence: high, medium or low.

| # | Claim | Status | Confidence | Evidence, captured_at 2026-11-01 |
|---|---|---|---|---|
| 1 | tramoka.com and the 8 other TLDs are unregistered | observed | high | RDAP URLs below |
| 2 | filara.ai, .io, .net, .so are unregistered | observed | high | RDAP |
| 3 | weavia.ai, .app, .dev, .org, .co, .so are unregistered | observed | high | RDAP |
| 4 | Checkout price for those is standard, not premium | unknown | low | RDAP cannot show it |
| 5 | .ai needs a 2-year minimum at Porkbun | observed | high | porkbun.com/tld/ai |
| 6 | No exact US mark for the ten names | reported | medium | Trademarkia |
| 7 | WEAVIATE is live in the US for database software | reported | high | Trademarkia 79325996 |
| 8 | UK and EU marks for all names | unknown | n/a | registers blocked |
| 9 | weavia.com will probably renew | inferred | medium | RDAP history |
| 10 | Tramoka has no bad meaning in other languages | unknown | n/a | not checked |
| 11 | Wake-word quality rankings | inferred, origin `model` | low | phonetic judgement only, no recogniser test |

## Contradictions

- C1: Porkbun states a 2-year .ai minimum; CostGoat agrees; Dynadot's table prices "1 year" at $85.60. Trust the 2-year minimum until a checkout shows otherwise. A web-search summary also reports one guide (NameBuddy) calling the minimum historical. Load-bearing only if .ai is bought.
- C2: A search snippet from markinton.com described TRAMAKO as live; Trademarkia shows it cancelled 2026-08-21. The date-stamped status is preferred. Confirm at USPTO.
- C3: The earlier session DNS check implied weavia.com was free. RDAP shows it registered since 2004. We were wrong: DNS failure does not mean unregistered.

## Unknown, and what would settle it

- UK IPO, EUIPO and USPTO official results: run the searches by hand or through the onnyx route. Cost is free; use the search pages for classes 9 and 42, including phonetic near matches.
- Premium status: put the name in a registrar cart, without paying.
- Asking prices for filara.com and weavia.com: a broker enquiry, which is outreach and needs his yes.
- Instagram, Reddit, X and TikTok handles: check logged in or in a browser.
- Non-English meanings of Tramoka, and real wake-word false-trigger rates.

## Proposed registry row (not added)

```json
{"provider":"baton-naming","subject":"domain-status-and-trademark-screen","source":"docs/research/baton-naming-domains-trademarks-2026-11-01.md","retrieved_at":"2026-11-01","assertion":"tramoka.com free at registry; official trademark registers unreachable from the box","refresh_interval_days":7,"severity":"low"}
```

## Sources, all 2026-11-01

- Registry RDAP: https://rdap.verisign.com/com/v1/domain/ , https://rdap.verisign.com/net/v1/domain/ , https://pubapi.registry.google/rdap/domain/ (.app, .dev), https://rdap.identitydigital.services/rdap/domain/ (.ai, .io), https://rdap.publicinterestregistry.org/rdap/domain/ (.org), https://rdap.registry.co/co/domain/ (.co), https://rdap.nic.so/domain/ (.so), https://rdap.rrpproxy.net/domain/WEAVIA.COM
- Bootstrap: https://data.iana.org/rdap/dns.json
- Prices: https://porkbun.com/products/domains , https://porkbun.com/tld/ai , https://www.dynadot.com/domain/tlds , https://www.dynadot.com/domain/ai , https://www.dynadot.com/domain/app , https://www.dynadot.com/domain/dev , https://www.cloudflare.com/products/registrar/
- Secondary prices: https://costgoat.com/compare/domains/ai , https://costgoat.com/compare/domains/com , https://costgoat.com/compare/domains/app
- Trademark, secondary: https://www.trademarkia.com/search/trademarks?query=weaviate , https://www.trademarkia.com/search/trademarks?query=tramako , https://markinton.com/trademark/tramako-88540337
- Blocked: https://tmsearch.uspto.gov/ , https://trademarks.ipo.gov.uk/ipo-tmtext , https://www.tmdn.org/tmview/ , https://euipo.europa.eu/eSearch/ , https://branddb.wipo.int/
- Namespaces: https://api.github.com/users/ , https://registry.npmjs.org/ , https://pypi.org/pypi/ , https://itunes.apple.com/search , https://play.google.com/store/search , https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle , https://find-and-update.company-information.service.gov.uk/search/companies
- Expiry lifecycle, secondary: https://support.dnsimple.com/articles/what-happens-when-domain-expires/ , https://www.name.com/support/articles/227849228-how-the-pending-delete-period-works
