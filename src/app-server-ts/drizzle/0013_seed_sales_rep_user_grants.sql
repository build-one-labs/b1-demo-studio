-- Seed demo authorization grants so the balance-masking feature is demonstrable out of the box.
-- demo2@build.one can see Asiya Javayant's customers.
-- demo3@build.one can see Asiya Javayant's and Ioni Bowcher's customers.
-- sales_rep_ids are looked up by name from the 0012 seed so this stays stable across reseeds.
INSERT INTO public.sales_rep_user_grants (user_email, sales_rep_id, relation)
SELECT 'demo2@build.one', sr.sales_rep_id, 'finance_viewer'
FROM public.sales_reps sr
WHERE (sr.first_name, sr.last_name) = ('Asiya', 'Javayant')
UNION ALL
SELECT 'demo3@build.one', sr.sales_rep_id, 'finance_viewer'
FROM public.sales_reps sr
WHERE (sr.first_name, sr.last_name) IN (('Asiya', 'Javayant'), ('Ioni', 'Bowcher'))
ON CONFLICT ON CONSTRAINT sales_rep_user_grants_user_rep_relation_unique DO NOTHING;
