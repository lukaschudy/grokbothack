// Run SQL against the Supabase project through the Management API (as postgres).
// Usage: tsx --env-file=.env.local scripts/supabase-sql.ts <file.sql | -e "sql">
import { readFile } from "node:fs/promises";

const ref = process.env.SUPABASE_PROJECT_REF ?? "qvojxftybzlrkonbftnw";
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) throw new Error("SUPABASE_ACCESS_TOKEN is not set");
const [flag, arg] = process.argv.slice(2);
const query = flag === "-e" ? arg! : await readFile(flag!, "utf8");
const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query })
});
const text = await res.text();
if (!res.ok) { console.error(res.status, text); process.exit(1); }
console.log(text.length > 2000 ? `${text.slice(0, 2000)}…` : text);
