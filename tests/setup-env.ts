process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://conecta_app:conecta_app@localhost:5432/conecta_test";
process.env.DATABASE_OWNER_URL = process.env.TEST_DATABASE_OWNER_URL ?? "postgres://conecta_owner:conecta_owner@localhost:5432/conecta_test";
process.env.APP_TIMEZONE = "America/Managua";
process.env.FILE_STORAGE_DIR = "./storage-test";
