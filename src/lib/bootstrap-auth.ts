import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";
import { withDbTransaction } from "@/lib/db";
import { insertAdminUser } from "@/lib/auth";

export async function ensureAuthSchemaFromMigration() {
  const migrationPath = path.join(process.cwd(), "supabase", "migrations", "20260403210000_auth_accounts_billing.sql");
  const sql = await readFile(migrationPath, "utf8");
  await withDbTransaction(async (client) => {
    await client.query(sql);
  });
}

export async function bootstrapAdminAccount(input: {
  email: string;
  password: string;
  organizationName?: string;
}) {
  await ensureAuthSchemaFromMigration();
  return withDbTransaction(async (client) => {
    const orgResult = await client.query(
      `insert into public.organizations
        (name, account_type, access_scope, status, requires_payment, notes)
       values ($1, 'free', 'both', 'active', false, 'Primary admin organization')
       on conflict (name) do update
         set access_scope = 'both',
             status = 'active',
             requires_payment = false,
             updated_at = now()
       returning id`,
      [input.organizationName || "DBCJASON Admin"],
    );
    const organizationId = String((orgResult.rows[0] as { id: string } | undefined)?.id || "");
    const userId = await insertAdminUser(client, {
      organizationId,
      email: input.email,
      password: input.password,
      accessScope: "both",
    });
    const existingBilling = await client.query(
      `select id from public.billing_records where organization_id = $1 limit 1`,
      [organizationId],
    );
    if (!existingBilling.rowCount) {
      await client.query(
        `insert into public.billing_records
          (organization_id, provider, status, notes)
         values ($1, 'manual', 'not_required', 'Primary admin organization')`,
        [organizationId],
      );
    }
    return { organizationId, userId };
  });
}
