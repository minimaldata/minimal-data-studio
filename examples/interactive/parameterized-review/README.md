# Parameterized review

Copy this folder into a Studio project's `interactive/` folder. In Analyses →
Interactive documents → Open app folder, enter its project-relative path. No
existing database tables are required: SQL supplies three synthetic payments.

1. Open Data inputs, Apply & refresh, then Reload app. Three rows should appear.
2. Set minimum amount to 1500 in the app and Stage parameters. The table stays unchanged.
3. Apply & refresh in Data inputs and Reload app. Two rows should remain.
4. Write a review note and Save document. Reopen to restore the note and snapshot.
5. Inspect SQL inline to replace the sample source with your own read-only SELECT.

This is an API version 1 / state version 1 example. It deliberately does not use
network access, credential access, external JavaScript, or automatic SQL execution.
