-- Seed sales_reps with rows matching the PrimeVue demo names used in clients.representative.
-- Lets the CustomerSearchRestrictedEvents mask-by-representative logic actually resolve to real sales_rep rows.
INSERT INTO public.sales_reps (first_name, last_name, email, hire_date, region)
VALUES
  ('Amy',      'Elsner',    'amy.elsner@example.com',      '2020-01-15', 'North America'),
  ('Anna',     'Fali',      'anna.fali@example.com',       '2019-03-22', 'Europe'),
  ('Asiya',    'Javayant',  'asiya.javayant@example.com',  '2021-06-01', 'Asia'),
  ('Bernardo', 'Dominic',   'bernardo.dominic@example.com','2018-11-10', 'South America'),
  ('Elwin',    'Sharvill',  'elwin.sharvill@example.com',  '2020-08-14', 'North America'),
  ('Ioni',     'Bowcher',   'ioni.bowcher@example.com',    '2017-04-30', 'Oceania'),
  ('Ivan',     'Magalhaes', 'ivan.magalhaes@example.com',  '2019-09-05', 'South America'),
  ('Onyama',   'Limba',     'onyama.limba@example.com',    '2022-02-18', 'Africa'),
  ('Stephen',  'Shaw',      'stephen.shaw@example.com',    '2016-12-01', 'North America'),
  ('Xuxue',    'Feng',      'xuxue.feng@example.com',      '2021-10-25', 'Asia')
ON CONFLICT ON CONSTRAINT sales_reps_email_key DO NOTHING;
