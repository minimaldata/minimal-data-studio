-- Synthetic, self-contained starter. Replace this VALUES source with your table.
SELECT paid_date, amount
FROM (VALUES (DATE '2026-01-15', 1200.00),
             (DATE '2026-02-15', 1600.00),
             (DATE '2026-03-15', 2400.00)) AS payments(paid_date, amount)
WHERE paid_date >= CAST($from_date AS DATE) AND amount >= $minimum_amount
ORDER BY paid_date;
