-- Exclude the company rollup so it is not shown as another customer segment.
SELECT * FROM saas_product_adoption WHERE employee_band <> 'All sizes' ORDER BY month_end, employee_band;
