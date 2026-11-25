-- One row per month. Retention uses the customer population from 12 months earlier.
SELECT k.*, r.nrr_12m_pct, r.grr_12m_pct,
       a.blended_cac_usd, a.estimated_payback_months, a.new_customers,
       c.total_cash_collected_usd
FROM saas_subscription_kpis k
LEFT JOIN saas_retention_12m r USING(month_end)
LEFT JOIN saas_acquisition_economics a USING(month_end)
LEFT JOIN saas_cash_collections c USING(month_end)
ORDER BY month_end;
