import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { sql } from "../lib/db";

const dir = path.join(import.meta.dirname, "..", "db", "migrations");
await sql`create table if not exists public.schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
const done = new Set((await sql<{ name: string }[]>`select name from public.schema_migrations`).map((r) => r.name));
for (const name of (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort()) {
  if (done.has(name)) continue;
  const body = await readFile(path.join(dir, name), "utf8");
  await sql.begin(async (tx) => {
    await tx.unsafe(body);
    await tx`insert into public.schema_migrations (name) values (${name})`;
  });
  console.log(`applied ${name}`);
}
await sql.end();
