# Lead Sniper — requested deliverables

1. **Workflow JSON:** `Lead-Sniper-Main.json` is the entry point. Import the four JSON files in `supporting-workflows/` as well; Main alone is not the complete automation.
2. **Successful Slack message screenshot:** A dummy lead message was successfully delivered in live execution.
3. **Logic Log:** `Logic-Log.md` describes request pacing, response headers, backoff, and persistent cooldowns.

## Import

Import all five workflows into one n8n project. Re-select the newly imported Process Lead and Discover One Page workflows in Main. Select GitHub/OpenAI credentials and enter the private Slack webhook in Send Slack. Run Setup, publish Record Errors, and select it as Error Workflow on the other four workflows. Publish workers and Main when configuration is complete. IDs can change during import, so relink dependencies.

All exported workflows are inactive, credentials are removed, and the Slack webhook is a placeholder. The deployed instance remains separate from these sanitized exports.

## Evidence limits

The Slack demonstration used a clearly labeled fictional profile and dummy rationale, not AI-generated text. OpenAI generation remains blocked by account credits. The owned repository Edwinzynx/hdsd-whisperFT replaces the inaccessible popular repository.