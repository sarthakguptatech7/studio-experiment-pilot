# Working demo recording plan

Target length: **2 minutes 40 seconds**. Presenter: Sarthak Gupta / ZwightX AI Labs.
Use captions if narration is unavailable. Show the working application and actual
responses; avoid a sequence of slides standing in for functionality.

## Recording preparation

Start from a clean rehearsal. Keep a second local live environment ready only
after its Flagsmith connection and warehouse are confirmed. Hide credential
files, auth headers, personal account details and unrelated tabs.

The opening section below is the current rehearsal workflow. A real local
Flagsmith integration run is now captured in `evidence/live-integration.json`.
The recording still needs to show that evidence or reproduce it. Do not imply
that a pasted evidence record is a newly executed live operation.

## Timed walkthrough

| Time | Show | Narration |
| --- | --- | --- |
| 0:00–0:16 | Workbench hero and visible Rehearsal badge | “I'm Sarthak from ZwightX. Studio OS Experiment Pilot helps an AI coding agent turn a content hunch into a controlled test, with a clear approval boundary. This first view is rehearsal mode, so its traffic and estimates are synthetic.” |
| 0:16–0:40 | Plan fields, toggle between the two equal-layout headline previews, then Prepare experiment | “The question is small: does a more specific headline make a visitor continue to a lesson? The page, content and CTA stay the same. The outcome is one event: continue clicked. This button uses a local template, not a model call.” |
| 0:40–0:58 | Exact flag, metric, 50/50 split, plan hash; check approval and launch | “Before anything changes, the reviewer sees the exact setup. The approval is attached to this plan hash. If the plan changes, it needs fresh review. The coding agent is not given an approval tool.” |
| 0:58–1:18 | Run the inconclusive scenario and show its failing check | “An experiment also needs a useful answer when it cannot choose a winner. Here, the evidence is inconclusive, so the rollout stays unavailable. A traffic-allocation mismatch is a separate blocked outcome.” |
| 1:18–1:42 | Return to Run, choose clear scenario, show the provenance note and development approval | “This synthetic scenario exercises the passing path. We show the counts, checks and local estimate, and still keep production locked. It proves the workflow, not that a real audience prefers the headline.” |
| 1:42–1:58 | Approve development rehearsal, review rollback, then Audit | “The reviewer explicitly approves the development rollout. The control snapshot supports rollback, and the audit retains what happened.” |
| 1:58–2:25 | **Actual integration evidence:** local live workbench or the captured Flagsmith response, SDK counts and verified rollback | “This separate run used a real local Flagsmith development instance: 800 scripted visitors, 1,124 accepted events, native results, and an applied treatment rollout followed by verified restoration of control. The processing is real; the audience is synthetic.” |
| 2:25–2:40 | Actual captured MCP tool call/proposal; return to workbench | “The coding assistant supplied the hypothesis and copy through this bounded proposal tool. The useful boundary is simple: propose, review, measure, then approve a development change with evidence and a way back.” |

## Verified integration evidence for the recording

The following values were read from the actual recorded run. Do not put
credentials in the video or exported submission evidence. A different UI run
will have different IDs and may have different assignment counts.

| Evidence to capture | Record after verification |
| --- | --- |
| Flagsmith instance and runtime | Official backend commit `181a4f6c335055bdca6b6b80e70692f36037a07f`, declared API version 2.68.0; real PostgreSQL 16.16; see `LOCAL_FLAGSMITH.md` |
| Scoped Development environment verified | Project 1 / environment 1; connection and warehouse verified |
| Actual flag, keyed treatment and metric created | Flag 1, treatment option 1, metric 1; scoped name in sanitized evidence |
| Experiment start confirmed as running | Experiment 1; recorded actual start trace |
| SDK exposure and conversion events accepted | 800 identities; 1,124 accepted events; SDK buffer flushed |
| Native Flagsmith results computed | Control 74/374; treatment 250/426; chance-to-win above 99.9%; positive reported lift interval |
| Development rollout completed | Actual response confirms completed experiment with treatment |
| Control state restored | API read-back confirmed; six SDK checks returned enabled control without further event recording |
| Coding-assistant tool call | Actual `propose_experiment` JSON-RPC request/response in `evidence/agent-tool-run.json`; no model API call occurs inside the tool |

If native statistics have not computed, show that state and say results are
pending. Do not substitute the local Beta estimate and call it a Flagsmith
result. If rollout or rollback was tested only with controlled adapter responses,
call it an adapter test; do not show it as a live completed change.

If no live model call was recorded, use: “The project includes an MCP route for
an external coding agent; this recording demonstrates its proposal interface.”
Do not narrate a manually supplied or deterministic proposal as model-generated.

## Suggested caption labels

- **Rehearsal · synthetic data · local estimate**
- **Exact-plan approval**
- **Insufficient evidence: keep collecting**
- **Development only · production locked**
- **Live Flagsmith integration · synthetic audience**
- **External agent proposal · human review required**

Keep the relevant label visible throughout each section, particularly across the
transition from local rehearsal estimates to Flagsmith-computed results.

## Recording checks

The final video should let a judge verify three things without guessing:

1. The application changes state in response to real clicks and returns actual
   evidence or errors.
2. Flagsmith performs core work in the separately identified live segment.
3. The agent's scope, the reviewer boundary and the data's provenance are clear.

End on the project's name. Add the exact public repository/video URLs to
`SUBMISSION.md` only after they exist and are accessible. A local recording file
is not yet a reviewer-accessible video submission.
