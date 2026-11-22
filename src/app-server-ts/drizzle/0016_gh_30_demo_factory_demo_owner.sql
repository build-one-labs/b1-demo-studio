-- GH-30: a demo has an owner, the e-mail of the user who created it. Existing
-- rows and demos imported from the repository's files keep it empty.
-- https://github.com/build-one-labs/b1-demo-studio/issues/30
ALTER TABLE "demo_factory_demos" ADD COLUMN "owner" text DEFAULT '' NOT NULL;