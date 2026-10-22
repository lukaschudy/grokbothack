import postgres from "postgres";

type Sql = postgres.Sql;
export type Tx = postgres.TransactionSql;

const globalForDb = globalThis as unknown as { roomlineSql?: Sql };

export const sql: Sql =
  globalForDb.roomlineSql ??
  postgres(process.env.DATABASE_URL ?? "postgres://postgres@localhost:54329/roomline", {
    prepare: false,
    max: 8,
    idle_timeout: 20,
    onnotice: () => {},
    connection: { search_path: "public, extensions" }
  });
globalForDb.roomlineSql = sql;

/**
 * Run queries as a member (or anonymously) so Postgres RLS decides what is
 * allowed. Mirrors what PostgREST does on Supabase.
 */
export function asUser<T>(uid: string | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`select set_config('role', ${uid ? "authenticated" : "anon"}, true),
                    set_config('request.jwt.claim.sub', ${uid ?? ""}, true)`;
    return fn(tx);
  }) as Promise<T>;
}
