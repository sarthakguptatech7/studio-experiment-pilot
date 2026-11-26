# Verification record — 26 November 2026

This is a working entry prepared for Toggle Wars Track 02. WeMakeDevs registration
is complete and a dedicated public GitHub repository has been created. The 2:42
demo is published and its rendered video verified. Complete source publication
remains in progress; accepted project submission has not been verified.

## Automated checks

`npm test` passed **42 checks** in the final implementation pass. They exercise
plan hashes, explicit approvals, consumed receipts, cross-origin rejection,
impossible evidence, inconclusive and mismatched samples, SQLite persistence,
D1-compatible atomic transitions, Flagsmith request shapes, real SDK behavior
with a controlled transport, event rejection handling and credential redaction.
Mocked transport tests are not presented as a live service run.

`npm run build` generated the Cloudflare Worker and embedded UI. The hosted
preview deliberately forces rehearsal mode and stores approval transitions in
D1. Live Flagsmith management runs on the configured local server.

The owner-private rehearsal deployment succeeded at
https://studio-experiment-pilot.sarthakgupta496399.chatgpt.site/.
Its access gate was verified in the browser. The cloud browser had no signed-in
owner session, so interaction behind that hosted gate remains unverified;
the local browser workflow and D1-compatible store logic were verified separately.

## Two separate real integration runs

Both runs used the unmodified official Flagsmith API source and the official
Node SDK with a local PostgreSQL warehouse. The audiences and their conversion
choices were scripted. These runs establish integration behavior, not real
customer preferences or business impact.

| Evidence | CLI integration | Browser workflow |
| --- | ---: | ---: |
| Experiment ID in disposable local instance | 1 | 2 |
| Synthetic identities | 800 | 800 |
| Control exposures / conversions | 374 / 74 | 399 / 80 |
| Treatment exposures / conversions | 426 / 250 | 401 / 210 |
| Accepted exposure + conversion events | 1,124 | 1,090 |
| Flagsmith chance treatment beats control | >99.9% | >99.9% |
| Treatment rollout | Completed | Completed through UI |
| Control restoration | API readback + six SDK checks | API readback through UI |

Sources: `evidence/live-integration.json` and
`evidence/browser-live-run.json`. The latter records the actual imported
proposal, evidence, reviewed launch, reviewed rollout, and reviewed rollback.
The coding assistant operated the demonstration controls under the owner's
authorization; this is not a claim that Sarthak personally clicked them.

The first live rollback exposed a genuine legacy nested-serializer requirement:
updates must carry the existing multivariate child row ID. The adapter was
corrected, restoration was verified against the running API and SDK, and the
earlier failure is preserved in the evidence's `failureHistory`.

The Flagsmith beta returned `srm_p_value: null`. Its current source reads the
environment default weights for that statistic while this experiment uses its
experiment rollout. The UI preserves that missing native statistic and labels
its separate chi-square check of actual warehouse exposures against the reviewed
50/50 allocation. The native positive lift interval and probability still gate
development rollout. No native statistic is fabricated.

## Agent interface

The coding assistant invoked the actual `propose_experiment` JSON-RPC tool.
`evidence/agent-tool-run.json` preserves the request and response. The tool saved
a bounded proposal and made no Flagsmith mutation. Its content was imported and
reviewed in the browser workflow. An external coding agent supplies the reasoning;
the local template button does not invoke a language model.

## Visual and interaction checks

The browser was used to inspect the desktop layout, import the agent proposal,
preserve its hypothesis, prepare the plan, review its exact change set, launch
the real experiment, send the SDK cohort, inspect native results, approve a
development rollout, restore control and export the audit. The same primary
flow was also checked in rehearsal mode. The narrated demo uses captured states
from the real browser run; it is a walkthrough, not an uncut screen recording.

## Remaining entry steps

Registration was verified in the signed-in event page, which shows **Registered**
and **Submit your project**. The linked submission page still says **No
submissions for this one** and accepts registrations only. This is a registered
participant, not an accepted project submission.

The dedicated public repository was created at
[studio-experiment-pilot](https://github.com/sarthakguptatech7/studio-experiment-pilot).
Initial repository files and the [demo README](../demo/README.md) are published.
Complete source publication remains in progress. The
[direct video attachment](https://github.com/user-attachments/assets/816d7d2c-d4f7-4e13-bd20-e16857656879)
loaded in the rendered player, reporting **162.09 seconds** (2:42). The demo
README was committed as `80fdac9e61683cf1a0f64b70cac571c5855c2d68`; the video is
hosted as a GitHub attachment rather than a binary source file.

- Complete publication and verify the repository source.
- Obtain a working organizer project-submission route.
- Submit Track 02 with verified repository/video links, then confirm the accepted
  state or receipt. Registration alone does not complete the project entry.

The published deadline is **29 November 2026, 8:00 PM IST**.

Official references:
- https://www.wemakedevs.org/hackathons/flagsmith/rules
- https://www.wemakedevs.org/hackathons/flagsmith/schedule
- https://docs.flagsmith.com/experimentation/set-up-with-a-coding-agent
- https://docs.flagsmith.com/experimentation/run-an-experiment
