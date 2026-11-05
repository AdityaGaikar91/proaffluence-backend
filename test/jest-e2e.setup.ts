// E2E runs without Redis by default — enable JOBS_ENABLED=true when redis is up.
process.env.JOBS_ENABLED = process.env.JOBS_ENABLED || 'false';
process.env.BENCHMARK_CRON_ENABLED = 'false';
