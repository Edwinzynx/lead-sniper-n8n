# Demo preparation — workflow guides

These five guides explain all 109 canvas elements with exact names, purpose, incoming/outgoing paths, key data mappings, runtime code excerpts and demo talking points.

**Screenshots included:** eight actual n8n canvas screenshots supplied by the project owner, embedded in the matching guides. Process Lead uses four sequential views. Originals are preserved unchanged. Generated SVG/Mermaid diagrams are supplemental.

## Recommended demo order

Main → Setup → Discover One Page → Process Lead → Record Errors.

## Guides

- [Lead Sniper | Cloud / Setup and Authenticated Preflight](00-setup-and-preflight.md) — 16 canvas elements.
- [Lead Sniper | Cloud / Main - Edwinzynx hdsd-whisperFT](10-main-coordinator.md) — 17 canvas elements.
- [Lead Sniper | Cloud / Discover One Page](20-discover-one-page.md) — 25 canvas elements.
- [Lead Sniper | Cloud / Process Lead](30-process-one-lead.md) — 48 canvas elements.
- [Lead Sniper | Cloud / Record Errors](40-shared-error-recorder.md) — 3 canvas elements.

## State vocabulary

- `state`: the item envelope passed between nodes and child workflows.
- `control`: the persistent repository row with owner/version/lease.
- `config`: parsed control JSON containing cursor, cutoff, cooldowns and model.
- `lead`: one saved user job, profile, pitch, payload and attempts.
- `lead_row_id`: database row identifier used for updates; different from the deduplication key.
- `repo_id:user_id`: stable deduplication reference.
- `more`: whether Main should fetch another page in this cycle.

## Honest closing statement for the demo

"GitHub discovery and labeled dummy Slack delivery have been verified live. The LLM path is configured and locally tested, but live generation is blocked by API credits. The accessible owned repository replaces a popular repository because of GitHub access restrictions; acceptance of that substitution is pending."

Dummy test nodes were temporary and removed; they are not part of these five workflows.

## Screenshot review notes

Main’s sticky note contains a stale 240-second timeout; the guide calls out the actual 180-second limit. Process Lead Part 3 has an overlapping trigger/AI Failed label; the guide explains the logical entry point and the hidden node. Screenshots show layout, not full-path test evidence.
