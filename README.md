# Studio OS Experiment Pilot

**Turn a content hunch into a decision.**

A focused experiment workbench for an AI coding agent and a human reviewer. The
agent can propose a headline experiment, inspect its plan, and assess aggregate
evidence. A reviewer approves the exact configuration before the application
changes a dedicated Flagsmith development environment.

The example tests two headlines on an **owned content-preview page**. It measures
`continue_clicked`. It does not predict Instagram reach, recommend a guaranteed
viral hook, or treat organic posts as a randomized experiment.

Built for Toggle Wars, **Track 02: AI Agents and Feature Flags**.

Public repository created:
[studio-experiment-pilot](https://github.com/sarthakguptatech7/studio-experiment-pilot).
Source and demo publication are in progress and have not yet been verified.
The prepared 2:42 walkthrough is staged as
[demo/Studio_Experiment_Pilot_Demo.mp4](demo/Studio_Experiment_Pilot_Demo.mp4).
WeMakeDevs registration is complete; final project submission remains pending.

Owner review: [private rehearsal preview](https://studio-experiment-pilot.sarthakgupta496399.chatgpt.site/).
This deployment requires the owner's ChatGPT sign-in. The source can also be run
locally without an account using the quick start below.

## Two explicit modes

| Mode | What runs | What the result means |
| --- | --- | --- |
| Hosted preview / local rehearsal | The workbench, approval receipts, fixed synthetic scenarios, local probability calculation, development rollout rehearsal and rollback rehearsal | Demonstrates the workflow and its decision boundaries. No Flagsmith resource or real audience is involved. |
| Configured local live mode | Actual Flagsmith Management API operations and the official Node SDK, against a dedicated development environment | Verifies integration with Flagsmith. A synthetic cohort is still synthetic even when Flagsmith processes its events and computes its results. |

The hosted build deliberately stays in rehearsal mode. Do not add management keys
to its browser code. Live integration is configured on the local server.

## Quick start: no account needed

Use **Node.js 22.13.0 or newer** and npm.

```bash
npm ci
cp .env.example .env
npm start
```

Open **http://127.0.0.1:8789**. The default is `PILOT_MODE=rehearsal`.

1. Prepare an experiment with one changed headline.
2. Review its flag name, event, split, thresholds and plan hash.
3. Check the approval box and launch the development rehearsal.
4. Run the clear, inconclusive or allocation-mismatch scenario.
5. Inspect the evidence and each decision check.
6. If the gates permit it, approve a development rollout rehearsal; review and
   execute its rollback.
7. Export the run to keep its plan, evidence, receipts and audit trail together.

The **Prepare experiment** button uses a bounded local template. It does not call
an AI model. The A/B layout preview is also separate from recorded evidence;
clicking its Continue button does not silently change the experiment's results.

## Use an AI coding agent

The included MCP server exposes proposal and inspection tools. Bring your own
MCP-capable coding client and its normal authenticated model connection.

Example client configuration:

```json
{
  "mcpServers": {
    "studio-experiment-pilot": {
      "command": "node",
      "args": [
        "/ABSOLUTE/PATH/TO/studio-experiment-pilot/scripts/mcp.mjs"
      ]
    }
  }
}
```

Replace the absolute path placeholder with this checkout's actual path. This
configuration uses the client's model; no model key is bundled in the project.

Suggested agent brief:

> Propose a controlled headline experiment for an owned tutorial-preview page.
> Compare a generic headline with a specific outcome while keeping layout,
> content, timing and the Continue CTA fixed. Use `continue_clicked` as the
> conversion. Supply the hypothesis and both headlines, save the proposal using
> the experiment tool, and explain what the reviewer must approve. Do not claim
> any measured audience result.

| Tool | Capability |
| --- | --- |
| `propose_experiment` | Validate and save the agent's explicit title, brief, hypothesis and two headlines |
| `inspect_proposal` | Read the latest proposal for review |
| `assess_evidence` | Apply advisory checks to supplied aggregate evidence; does not attest that the input is genuine |
| `workflow_boundaries` | Explain what the agent can do and what the reviewer controls |

The proposal is saved to `data/agent-proposal.json`. Import it in the workbench,
prepare a fresh validated plan, and review the displayed changes. Import does not
import an approval. A provenance label is descriptive metadata, not proof that a
particular model authored the proposal.

There are **no MCP approval, rollout, shell or arbitrary file-reading tools**.
The agent proposes; the review interface owns the explicit approval actions.

## Connect a real Flagsmith development environment

Follow [the local Flagsmith guide](docs/LOCAL_FLAGSMITH.md) for the verified local
procedure and run-specific evidence. The general upstream route is Flagsmith's
[official local setup guide](https://docs.flagsmith.com/getting-started/run-locally-with-a-coding-agent).
It uses Docker Compose and configures the warehouse needed for experimentation.
Flagsmith Cloud is another option with an appropriate account and warehouse.

Use a **dedicated Development environment**. Set the following locally, following
`.env.example`; the values below are descriptions, not credentials:

| Environment variable | Purpose |
| --- | --- |
| `PILOT_MODE=live` | Enable actual server-side Flagsmith operations |
| `FLAGSMITH_API_URL` | Flagsmith origin, such as `http://localhost:8000` for a local instance |
| `FLAGSMITH_API_KEY` | Organization management key for the selected development project |
| `FLAGSMITH_ENVIRONMENT_KEY` | Environment key for the selected Development environment |
| `FLAGSMITH_PROJECT_ID` | Numeric project ID matching that environment |
| `FLAGSMITH_EVENTS_URL` | Event-ingestion base; local setup uses `http://localhost:8000/api/` |
| `PILOT_PORT` | Local application port; default `8789` |
| `PILOT_SIGNING_SECRET` | Optional stable signing secret, at least 32 characters; local startup generates a private one when omitted |

Restart the local application after changing its environment. Check Connections
before approving a live launch. Configured values alone are not a verified
connection, and an integration failure does not fall back to a successful
rehearsal response.

### Where Flagsmith does the work

The server-side adapter checks the project/environment scope and warehouse,
creates a uniquely named multivariate flag with a keyed treatment, creates the
occurrence metric, configures a 50/50 experiment and starts it after approval.
The official `@flagsmith/nodejs` SDK is the integration point for identity-based
assignment, exposure and conversion events. The same identity must be used for
both exposure and conversion, and buffered SDK events must be flushed.

Flagsmith results are read from its results API. Their raw payload is preserved;
missing or unfamiliar statistics remain unknown. The adapter also implements
development completion and restoration of its captured control configuration,
including read-back verification. The live procedure documents which operations
were actually executed in this build; implementation alone is not a claim of a
successful end-to-end run.

A synthetic cohort sent through the official SDK is an **integration test**. Its
Flagsmith-computed probability is distinct from the local rehearsal estimate,
and neither demonstrates real-world content impact.

### Verified live run: 26 November 2026

The [sanitized integration record](evidence/live-integration.json) captures a
completed run against the official Flagsmith backend and a real local PostgreSQL
warehouse. The official Node SDK delivered and flushed **1,124 accepted events**
for **800 synthetic visitors**:

| Variant | Assigned visitors | Synthetic conversions | Conversion rate |
| --- | ---: | ---: | ---: |
| Control | 374 | 74 | 19.8% |
| Treatment | 426 | 250 | 58.7% |

Flagsmith returned a treatment chance-to-win above 99.9% and a positive reported
lift interval. These large differences were deliberately induced by the traffic
generator. They are test inputs/outcomes, not customer findings.

The actual experiment completed with treatment, and rollback restored the
captured control configuration. Six subsequent SDK identity evaluations returned
enabled control, without recording further events. The record retains an
initial rollback API incompatibility and its resolved verification rather than
erasing that development history.

This Flagsmith beta response did not supply a native sample-ratio p-value. The
decision record separately labels its local allocation check, computed from the
actual warehouse counts against the approved 50/50 split. It is not described as
a native Flagsmith statistic.

An actual coding-assistant `propose_experiment` MCP invocation and response are
recorded in [agent-tool-run.json](evidence/agent-tool-run.json). The assistant
supplied the proposal; the MCP tool itself does not call a model API.

To run a new, explicitly approved local integration demonstration after setup:

```bash
node --env-file-if-exists=.env scripts/live-demo.mjs --approve-demo
```

The optional `--approve-rollout` flag also authorizes the bounded development
rollout/rollback demonstration if its native evidence checks pass. Read the
script and confirm the dedicated development environment before using it. The
default evidence output is `evidence/live-integration.json`; use `--out
evidence/my-live-run.json` to retain the earlier run.

Official integration references:

- [Set up an experiment with a coding agent](https://docs.flagsmith.com/experimentation/set-up-with-a-coding-agent)
- [Run an experiment and instrument SDK events](https://docs.flagsmith.com/experimentation/run-an-experiment)
- [Flagsmith source](https://github.com/Flagsmith/flagsmith)

## Evidence and approval rules

The bounded example uses these gates:

| Check | Rule |
| --- | --- |
| Visitors | At least 50 per variant |
| Conversions | At least 5 per variant |
| Allocation | Stop if the local sample-ratio check has p-value below 0.001 |
| Treatment evidence | At least 95% probability of beating control, with a higher observed conversion rate |
| Scope | Development only; production promotion stays locked |
| Review | The approved hash must match the current plan and action |

These are demonstration thresholds, **not a power analysis or a generally valid
stopping rule for every experiment**. A real deployment needs a metric definition,
an appropriate sample/horizon, effect-size considerations and relevant guardrails.
Live evidence also has to support the treatment through the platform's reported
lift interval and the documented allocation checks.

Rehearsal estimates use a uniform Beta(1,1) prior and 12,000 reproducible Monte
Carlo draws. They are labelled local estimates, not Flagsmith analysis. Clear,
inconclusive and mismatched traffic scenarios exist to exercise different paths.

Receipts are signed and tied to the plan, action, mode and development scope.
They expire after 24 hours. Tampering with a reviewed plan, evidence or receipt
must not grant permission to roll out. A newly prepared plan needs fresh review.
A durable approval ledger also rejects consumed or out-of-order receipts. Local
state uses SQLite; the hosted rehearsal uses its configured D1 store.

### Trust boundary and limitations

This is a local, single-owner developer tool. The review UI and signed receipts
provide a visible workflow boundary; they are not an independent human-identity
attestation. A trusted local process can call the local HTTP API. Do not expose
the live local server as a public multi-user service without adding appropriate
authentication, authorization and operational controls.

Keys remain server-side. The default local server binds to loopback, rejects
cross-origin browser writes, and does not expose arbitrary shell execution.
The `PORT` development-preview path is a separate, explicit hosting mode.

## Development and verification

```bash
npm test
```

Tests cover stale-plan rejection, receipt forgery, evidence modification,
production rejection, inconclusive and mismatched evidence, API boundaries,
MCP tool restrictions, management API request shapes, scope checks and rollback
verification. Adapter tests use controlled responses; they do not establish a
live provider connection.

The build verification on 26 November 2026 reported **42 passing automated
checks**. The live integration record above is separate evidence for real service
behavior; rerun `npm test` after changing the source.

```bash
npm run build
```

The build packages an owner-private rehearsal Worker for the project's Sites
configuration. It does not turn the local live integration into a public service.

| Path | Responsibility |
| --- | --- |
| `web/` | Workbench and owned-page interface |
| `src/core.mjs` | Plan validation, evidence checks, local rehearsal estimates and receipts |
| `src/api.mjs` | HTTP routes and approval checks |
| `src/flagsmith.mjs` | Bounded server-only Flagsmith Management API adapter |
| `scripts/server.mjs` | Local server and local audit persistence |
| `scripts/mcp.mjs` | Proposal/inspection tools for an external coding agent |
| `tests/` | Focused core, HTTP, MCP and adapter checks |
| `docs/LOCAL_FLAGSMITH.md` | Local integration setup and verification procedure |
| `docs/SUBMISSION.md` | Submission draft and remaining entry requirements |
| `docs/DEMO_SCRIPT.md` | Short working-demo recording plan |

Runtime records live under `data/` and are excluded from source distribution.
Browser storage retains the current review session. Exported JSON can include
your proposal and audit details, so review it before sharing.

## Origin and license

This standalone project was created on **26 November 2026**, inspired by the
experimentation need in Sarthak Gupta's existing Studio OS. The older private
editor, memory, recordings, customer data and motion-asset libraries are not
bundled. It is not presented as a newly written replacement for that whole app.

Original project code is MIT-licensed; see [LICENSE](LICENSE). Dependencies retain
their own licenses. No license to private media, identities or trademarks is
implied.
