# One lead's journey through Assignment 1

This fictional story follows **one new star through to Slack**, using the actual Cloud workflow nodes. The person, IDs, times, responses and pitch below are illustrative—not a recorded execution or a message sent to Slack.

One detail matters: **Main processes existing jobs before discovering new stars.** This complete journey therefore crosses two scheduled cycles.

## Meet the dummy lead

At **09:02**, Maya Rao stars `Edwinzynx/hdsd-whisperFT`.

| Field | Fictional value |
| --- | --- |
| GitHub username / user ID | `sample-dev-9001` / `9001` |
| Repository ID | `1234` |
| Followers / public repositories | **101 / 12** |
| Bio | Builds open-source speech tools. |
| Company | Example Voice Lab |
| Saved lead key | `1234:9001` |

Assume credentials work, services respond promptly, and no other execution owns the lease.

## 1. Before the star: Setup establishes the baseline

**Workflow: Setup and Preflight**  
**Beginning:** `Manual Setup` → **Endpoint:** `Insert Initial Control` for this fresh setup.

At **09:00**, the operator runs Setup. `Repository → Check Repository → Validate Repository` confirms the repository identity. `Check Stargazer Access → Require Listing Access` verifies that the credential can retrieve timestamped stars.

`Create control Table`, `Create leads Table` and `Create events Table` prepare storage. `Find Existing Control → Validate Singleton → Needs Initialization?` finds no existing control row, so `Initialize Monitoring → Insert Initial Control` saves **09:00 as the fixed cutoff** and page 1 as the cursor.

Setup now ends; it does not call Main. Maya's 09:02 star is eligible because it occurs after the cutoff. Rerunning Setup would preserve the existing cutoff and end on the false branch of `Needs Initialization?`.

## 2. At 09:05: Main discovers Maya

**Workflow: Main Coordinator**  
**Beginning:** `Every Five Minutes` → **Endpoint:** `Release Lease` after its child work finishes.

`Read Control → Prepare Lease → Lease Available? → Acquire Conditional Lease → Cycle Context` gives this execution ownership and its work deadline.

`Get Due Leads` finds no queued jobs. `Prepare Lead Jobs → Loop Leads → Process Lead` passes a skip item to the processor, which returns through `Return Outcome` without calling GitHub, AI or Slack.

Main then follows `Prepare Page Slots → Loop Pages → Discover Page`, calling the discovery workflow.

### Inside Discover One Page

**Beginning:** `When Executed by Another Workflow` → **Endpoint:** `Return Outcome`, returning to Main's `Discover Page` node.

`Read Control → Prepare Page → Page Allowed?` confirms ownership, time and GitHub availability. `Pace GitHub → Fetch Stargazer Page` waits one second and fetches the saved page. The response includes Maya's ID, login and 09:02 star time.

`Classify Page → Page Succeeded? → Normalize Page → Page Valid?` accepts the response. `New Stars Only` keeps Maya because 09:02 is later than 09:00.

`Candidates Present? → Find Existing Candidate Keys → Remove Seen Leads → Any New Leads?` finds no stored `1234:9001` key. `Insert New Leads in Bulk` saves:

```json
{"key":"1234:9001","status":"queued","stage":"profile","pending":true}
```

This is a shortened view of the saved row; its JSON also contains identity, timestamps, retry counts and initially empty profile/pitch/payload fields.

`Advance Saved Cursor → Commit Cursor → Return Cursor → Return Outcome` checkpoints the scan **after** insertion. Assume this is the last page: the next scan resets to page 1 and the child returns `more=false`.

Back in Main, `Continue Scan?` takes its false branch to `Release Lease`. **The 09:05 execution ends with Maya queued, not notified.**

## 3. At 09:10: Main processes Maya

Main starts again at `Every Five Minutes`, reacquires ownership, and `Get Due Leads` now selects Maya. `Prepare Lead Jobs → Loop Leads → Process Lead` passes her saved lead and row ID into the processor.

### Inside Process Lead: profile and qualification

**Beginning:** `When Executed by Another Workflow` → **Endpoint:** `Return Outcome`, returning to Main's `Process Lead` node.

`Read Control → Prepare Lead → Recover Uncertain Send? → Time and Lease Available?` confirms this is ordinary queued work with enough time remaining.

`Needs Profile? → Prepare Profile → GitHub Available? → Pace Profile Request → Fetch Profile` requests `/users/sample-dev-9001`.

`Classify Profile → Profile Succeeded? → Normalize and Filter` checks that the returned ID is **9001** and the counts are valid integers. Maya qualifies because **101 > 100**, even though 12 repositories is below the other threshold.

`Save Profile → Profile Saved → Qualified Lead?` preserves her profile and advances the stage to **ai**. An unqualified user would instead be saved as rejected and return without AI or Slack.

### AI generation and persistence

`Needs AI? → Prepare AI Prompt → Generate Pitch` requests one sentence using Maya's bio/company. `Generate Pitch` uses the attached **OpenAI Model** subnode.

Suppose the model returns this illustrative sentence:

> Their work on speech tools at Example Voice Lab provides a relevant starting point for discussing shared technical interests.

`Validate Pitch → Pitch Valid?` accepts its format. No repair is needed; an invalid sentence would go through `Prepare Repair → Repair Pitch Once → Validate Repair → Repair Valid?`.

`Prepare Saved Pitch → Save Pitch and Payload → Pitch Saved` saves the sentence and exact Slack payload, advancing to **delivery**. A later delivery retry can reuse them without another AI call.

### Slack delivery and the processor's endpoint

`Prepare Send Check → Recheck Send Lease → Authorize Send → Send Allowed?` verifies current ownership, remaining time and Slack availability.

`Mark Sending → Sending Checkpoint Saved → Send Slack` first persists **sending**, then posts Maya's name, bio/company, counts, rationale, profile link and reference **1234:9001**.

Assume Slack returns **HTTP 200 with `ok`**. `Classify Slack → Outcome Checkpoint → Save Lead Outcome → Restore Outcome → Save Service Cooldowns → Outcome Saved → Return Outcome` saves **delivered**, sets **pending=false**, and returns to Main.

### Main finishes its iteration

Main returns to `Loop Leads`. After its selected jobs finish, it runs discovery again if the time gates allow. If Maya appears again, `Find Existing Candidate Keys → Remove Seen Leads` recognizes her saved key and does not insert another job.

Main ultimately reaches **`Release Lease`**. The 09:10 iteration ends with Maya delivered and her key retained for future deduplication.

## 4. Where Record Errors fits

**Workflow: Record Errors**  
**Beginning:** `Unexpected Failure` → **Endpoint:** `Persist Error`.

This workflow **does not run on the successful path above**. If an unhandled failure—such as a Data Table write error—fails a linked production execution, `Unexpected Failure → Safe Error Detail → Persist Error` records sanitized execution/workflow/node information. It does not resume Main or send a Slack alert.

Handled failures follow their own branches: AI failures can defer the lead; Slack 429 can schedule a delivery retry; a Slack timeout takes `Slack Outcome Unknown` and saves **delivery_unknown**. That last case requires checking the channel before authorizing another send.

## Start and finish at a glance

| Workflow | Starts at | Finishes at in this story |
| --- | --- | --- |
| Setup and Preflight | `Manual Setup` | `Insert Initial Control` |
| Main Coordinator | `Every Five Minutes` | `Release Lease` each cycle |
| Discover One Page | `When Executed by Another Workflow` | `Return Outcome` → Main's `Discover Page` |
| Process Lead | `When Executed by Another Workflow` | `Return Outcome` → Main's `Process Lead` |
| Record Errors, only on unexpected failure | `Unexpected Failure` | `Persist Error` |

For the general explanation, see [the end-to-end guide](01-END-TO-END.md) and [individual workflows](02-WORKFLOWS.md). This story is based on the [Main export](../../deliverables/workflows/Lead-Sniper-Main.json) and its [four supporting workflows](../../deliverables/workflows/supporting-workflows).
