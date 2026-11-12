// Point the app's db() at the throwaway test database before any handler loads.
if (process.env.TEST_DATABASE_URL) {
  process.env.POSTGRES_URL = process.env.TEST_DATABASE_URL;
  process.env.PGSSLMODE = "disable";
}
