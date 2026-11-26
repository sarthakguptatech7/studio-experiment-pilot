# Toggle Wars submission draft

**Status: registration completed; source and demo published; project submission blocked by the organizer's current form.**

| Field | Draft value |
| --- | --- |
| Project | Studio OS Experiment Pilot |
| Track | Track 02 — AI Agents and Feature Flags |
| Author / team | Sarthak Gupta / ZwightX AI Labs |
| WeMakeDevs registration | **Completed — registered state verified** |
| Public GitHub repository | [studio-experiment-pilot](https://github.com/sarthakguptatech7/studio-experiment-pilot) — complete source published and verified |
| Working demo video | [Published 2:42 walkthrough](../demo/README.md) · [direct video](https://github.com/user-attachments/assets/816d7d2c-d4f7-4e13-bd20-e16857656879) — rendered video verified |
| Hosted preview | [Private rehearsal preview](https://studio-experiment-pilot.sarthakgupta496399.chatgpt.site/) — deployed; owner sign-in required; reviewer access not enabled |
| Deadline | 29 November 2026, 8:00 PM IST |

The [official rules](https://www.wemakedevs.org/hackathons/flagsmith/rules) require
a public GitHub repository, a README explaining setup and Flagsmith usage, and a
short working-project video. Every team member must register. This entry targets
one track only. Do not replace any pending item with a guessed URL.

## Short description

Studio OS Experiment Pilot helps an AI coding agent turn a content hypothesis
into a controlled, reviewable Flagsmith experiment. The agent proposes the
headline test; a reviewer approves the exact configuration. The workbench keeps
evidence provenance, insufficient-data decisions, development rollout and
rollback visible in one audit trail.

## Problem

Creating two content variants is easy. Deciding what to test, defining success,
instrumenting exposure and conversion consistently, and interpreting the result
takes more care. An agent can assemble a plausible experiment quickly, but a
team still needs to know what will change and whether the evidence supports the
next action.

For a creator, organic post comparisons introduce another problem: the audience
and distribution can change between posts. This project deliberately tests an
owned preview page so that the experiment has an assignable audience and a
specific conversion event.

## Solution

The coding agent supplies a hypothesis and two headlines through bounded MCP
tools. Experiment Pilot creates a plan with one multivariate flag, a keyed
treatment, a 50/50 allocation and the `continue_clicked` metric. The reviewer sees
and approves those exact fields before a local live server uses Flagsmith's
Management API.

In rehearsal mode, labelled synthetic scenarios exercise the decision gates.
The clear scenario can open a development rollout; inconclusive evidence calls
for more data; an allocation mismatch stops the decision. Each path produces a
reviewable result rather than silently choosing a winner.

The live integration uses a real Flagsmith development environment. Official SDK
events and native Flagsmith statistics must be described separately from the
local rehearsal estimator. If the cohort is synthetic, that remains visible
even when the processing and statistics come from Flagsmith.

## What makes it useful

- **The approval is attached to the exact plan.** Changing the reviewed copy or
  configuration invalidates the old hash.
- **The agent has a limited role.** It can propose and inspect, but receives no
  approval or rollout tool.
- **Evidence can stop the workflow.** Insufficient evidence and unequal
  assignment are demonstrated as first-class outcomes.
- **Provenance is part of the result.** A local estimate, a Flagsmith result and
  a synthetic audience are different facts and are labelled accordingly.
- **Recovery is visible.** The development workflow keeps a control snapshot
  and an inspectable rollback path.

## Flagsmith implementation

Flagsmith is the actual development integration, not a decorative toggle on a
dashboard. The adapter checks scope and warehouse availability, creates the
flag/metric/experiment, starts the approved experiment, reads native results,
and implements completion and restoration of its captured control state.

The official Node SDK supplies identity-based experiment evaluation and event
delivery in live testing. A real Flagsmith service processing a scripted cohort
demonstrates the integration; it does not demonstrate a real business lift.

On **26 November 2026**, the actual local backend/warehouse run assigned 800
synthetic identities, accepted 1,124 exposure/conversion events, and returned
native Flagsmith results. Control had 374 assigned visitors and 74 conversions;
treatment had 426 assigned visitors and 250 conversions. The intentionally
different conversion tendencies produced a Flagsmith chance-to-win above 99.9%
and a positive reported lift interval.

The development rollout completed with treatment. Rollback restored control,
verified both through the API and six subsequent SDK identity evaluations.
The sanitized evidence is in
[`evidence/live-integration.json`](../evidence/live-integration.json). A native
Flagsmith sample-ratio p-value was unavailable in that response; the evidence
explicitly identifies its separate local allocation check.

The actual coding-assistant MCP proposal call is preserved in
[`evidence/agent-tool-run.json`](../evidence/agent-tool-run.json). The tool does
not make a model API request; it saves the proposal supplied by the assistant.
Build verification reported 42 passing automated checks. None of these checks
or synthetic cohorts is presented as measured customer impact.

## Prior work and AI assistance disclosure

Sarthak's existing Studio OS supplied the product context: keeping content
experiments and decisions organized. This hackathon project is a **new standalone
implementation created on 26 November 2026**. It does not include the older
private editor, personal memory, recordings, customer data or creative libraries.

AI coding assistance was used to implement and review this project. The app's
local template planner is not represented as a model invocation. The MCP path
uses an external coding agent and its normal account; no model account is
bundled. The participant should be able to explain the submitted implementation.

## Five concise judge answers

### 1. Why is this an AI-agent project?

It gives a coding agent a bounded experiment job: propose a concrete hypothesis
and variants, inspect the plan, and assess evidence. The proposal becomes a
reviewable Flagsmith workflow. A recording must show the actual agent tool call
to support a claim that a live model completed that step; the local template
button alone is not the agent demonstration.

### 2. What is Flagsmith doing that the app cannot fake?

In live mode, Flagsmith owns the development flag and experiment. The SDK
evaluates its assignments and sends exposure/conversion events; the results API
returns native analysis. The adapter preserves those responses and treats
unavailable results as unavailable.

### 3. Why not automatically ship the apparent winner?

A statistically promising number is not enough. The workbench checks sample
counts and allocation, makes the evidence source visible, and requires a new
reviewed development action. Production promotion stays outside this demo.

### 4. Are the results real audience impact?

No. Rehearsal fixtures and scripted live cohorts are synthetic. The real result
we can demonstrate is that assignments, events, checks and approved changes work
through the implemented path. Audience impact requires a properly designed real
experiment.

### 5. What would you build next?

An authenticated team review surface, more carefully chosen metrics/guardrails,
and ingestion from a genuinely owned audience surface. Each addition would keep
provenance and rollback explicit. The current live development integration and
its captured evidence provide the foundation.

## Remaining entry steps

WeMakeDevs registration is complete: the signed-in event page shows
**Registered** and **Submit your project**. The linked submission page still
says **No submissions for this one** and presents registrations only. No
project submission has been accepted.

The dedicated public repository linked above contains the complete source,
tests, setup guide and sanitized evidence, verified against the prepared package.
The **2:42**
narrated walkthrough is published through the demo README and the direct video
link above. Its rendered player loaded successfully. The walkthrough uses
captured states from the real browser run, a synthetic voice and explicit
synthetic-audience labels.

1. Obtain a working organizer submission route, then enter Track 02 and the final
   verified repository and video links.
2. Confirm the form's accepted submission state or receipt. A filled draft,
   registration confirmation or local build is not submission confirmation.

Use the official event page for the current form state and schedule:
https://www.wemakedevs.org/hackathons/flagsmith
