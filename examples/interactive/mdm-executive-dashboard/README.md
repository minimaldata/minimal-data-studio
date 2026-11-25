# MDM executive dashboard

A Studio folder app using synthetic MDM SaaS views. Open `interactive/mdm-executive-dashboard`, refresh Data inputs, and Save document. No automatic queries on open or slider changes.

Reporting month, trend measure/window, and review notes persist in document state. Results are calculated from the saved input snapshot; Refresh inputs explicitly replaces it. Use Save document after changes. The selected month stays fixed on refresh if still available, rather than silently jumping to the newest month.

The app requires the six saas_* views named in its SQL files. Each input is bounded by Studio's snapshot limits. No separate warehouse connection or credentials are needed. SQL is inspectable and editable through Studio. Source uses the existing sandbox's classic-script folder format, with no external dependencies or network access.

MRR and cash are distinct. Retention is the existing view's 12-month revenue-weighted cohort retention; ratios are not averaged across months. Payback is the existing view's estimate. Product mix is scoped to the selected month and does not filter executive metrics. Missing acquisition or retention values display a dash.
