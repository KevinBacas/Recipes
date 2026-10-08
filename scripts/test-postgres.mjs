import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { Client } from "pg";

let container;
let url = process.env.TEST_POSTGRES_URL;
try {
  if (!url) {
    container = `recipes-tests-${process.pid}`;
    const database = `recipes_test_${process.pid}`;
    execFileSync(
      "docker",
      [
        "run",
        "--detach",
        "--rm",
        "--name",
        container,
        "-e",
        "POSTGRES_PASSWORD=recipes-local-test",
        "-e",
        `POSTGRES_DB=${database}`,
        "-p",
        "127.0.0.1::5432",
        "postgres:17-alpine",
      ],
      { stdio: ["ignore", "ignore", "inherit"] },
    );
    const port = execFileSync("docker", ["port", container, "5432/tcp"], { encoding: "utf8" })
      .trim()
      .split(":")
      .at(-1);
    url = `postgresql://postgres:recipes-local-test@127.0.0.1:${port}/${database}`;
  }
  const target = new URL(url);
  if (
    !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) ||
    !/^\/recipes_test_[a-z0-9_]+$/.test(target.pathname)
  ) {
    throw new Error("La cible doit être une base locale dédiée recipes_test_*.");
  }
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    const client = new Client({ connectionString: url });
    try {
      await client.connect();
      ready = true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    } finally {
      await client.end();
    }
    if (ready) break;
  }
  if (!ready) throw new Error("PostgreSQL local indisponible.");
  const child = spawn(
    process.execPath,
    ["node_modules/vitest/vitest.mjs", "run", "--config", "vitest.postgres.config.ts"],
    {
      stdio: "inherit",
      env: { ...process.env, TEST_POSTGRES_URL: url },
    },
  );
  const [code] = await once(child, "exit");
  process.exitCode = code ?? 1;
} finally {
  if (container) {
    try {
      execFileSync("docker", ["rm", "--force", container], { stdio: "ignore" });
    } catch {
      /* Creation may have failed before the container existed. */
    }
  }
}
