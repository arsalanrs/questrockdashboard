import { clearSyncData, generateMockLoanData, importShapeKpiCsv, mockEnrichImportedLoans, resetUserPassword } from "./actions";
import { createTeam, createUserAndAssign, seedInitialOrg } from "./org-actions";
import { ShapeApiPreview } from "./ShapeApiPreview";
import { SyncNowButton } from "./SyncNowButton";
import { requireCurrentUser } from "@/lib/current-user";
import { canAccessAdmin } from "@/lib/permissions";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type Props = {
  searchParams?: {
    ok?: string;
    error?: string;
    batch?: string;
    rows?: string;
    loans?: string;
    created?: string;
    enriched?: string;
    seeded?: string;
    sync?: string;
    syncPages?: string;
    syncRecords?: string;
    syncLoans?: string;
    syncSkipped?: string;
    unmapped?: string;
    cleared?: string;
    passwordReset?: string;
  };
};

export default async function AdminImportPage({ searchParams }: Props) {
  const { appUser } = await requireCurrentUser();
  if (!canAccessAdmin(appUser.role)) notFound();

  const supabase = await createSupabaseServerClient();
  const [{ data: teams, error: teamsErr }, { data: users, error: usersErr }] = await Promise.all([
    supabase.from("teams").select("id,name,manager_user_id").order("name", { ascending: true }),
    supabase.from("users").select("id,full_name,email,role,primary_team_id").order("full_name", { ascending: true }),
  ]);
  if (teamsErr) throw teamsErr;
  if (usersErr) throw usersErr;

  const teamNameById = new Map<string, string>();
  (teams ?? []).forEach((t) => teamNameById.set(t.id, t.name));

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Admin</h1>
        <p className="text-sm text-mutedForeground">Import Shape KPI CSV into Supabase (raw + normalized loans).</p>
      </div>

      <div className="rounded-lg border border-border bg-card p-5 text-cardForeground">
        <h2 className="text-sm font-semibold">Import: Shape KPI CSV</h2>
        <p className="mt-1 text-sm text-mutedForeground">
          Upload the exported report (e.g. <span className="font-mono">customreportcsv_*.csv</span>).
        </p>

        {searchParams?.error ? (
          <div className="mt-4 rounded-md border border-border bg-muted px-3 py-2 text-sm">{searchParams.error}</div>
        ) : null}
        {searchParams?.ok ? (
          <div className="mt-4 rounded-md border border-border bg-muted px-3 py-2 text-sm">
            {searchParams.batch ? (
              <>
                Imported. Batch <span className="font-mono">{searchParams.batch}</span> ({searchParams.rows} rows,{" "}
                {searchParams.loans} loans).
              </>
            ) : null}
            {searchParams.created ? <> Created {searchParams.created} mock loans.</> : null}
            {searchParams.enriched ? <> Enriched {searchParams.enriched} loans.</> : null}
            {searchParams.seeded ? <> Seeded initial org users/teams.</> : null}
            {searchParams.sync ? (
              <>
                Shape API sync: {searchParams.syncPages} pages, {searchParams.syncRecords} records, {searchParams.syncLoans} loans
                upserted.
                {searchParams.unmapped ? (
                  <span className="block mt-2">
                    Unmapped statuses (add to stage_mapping): {searchParams.unmapped}
                  </span>
                ) : null}
              </>
            ) : null}
            {searchParams.cleared ? " All synced data cleared. You can sync again." : null}
            {searchParams.passwordReset ? " Password updated." : null}
          </div>
        ) : null}

        <form action={importShapeKpiCsv} className="mt-4 flex flex-col gap-3">
          <input
            name="file"
            type="file"
            accept=".csv,text/csv"
            required
            className="block w-full text-sm file:mr-4 file:rounded-md file:border file:border-border file:bg-background file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-muted"
          />
          <button
            type="submit"
            className="inline-flex w-fit items-center rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background hover:opacity-90"
          >
            Import CSV
          </button>
        </form>

        <div className="mt-6 border-t border-border pt-5">
          <h3 className="text-sm font-semibold">Shape API sync</h3>
          <p className="mt-1 text-sm text-mutedForeground">
            Pull leads from Shape&apos;s bulk export API and upsert into the same loans pipeline (no CSV). Configure{" "}
            <span className="font-mono">SHAPE_API_KEY</span> in .env.local.
          </p>
          <ShapeApiPreview />
          <SyncNowButton />
        </div>

        <div className="mt-6 border-t border-border pt-5">
          <h4 className="text-sm font-medium">Clear data</h4>
          <p className="mt-1 text-xs text-mutedForeground">
            Erase all synced data (raw, loans, leads, etc.). Run sync again after to repopulate.
          </p>
          <form action={clearSyncData} className="mt-2">
            <button
              type="submit"
              className="rounded-md border border-amber-600/50 bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-700 hover:bg-amber-500/20 dark:text-amber-400 dark:hover:bg-amber-500/20"
            >
              Clear all synced data
            </button>
          </form>
        </div>

        <p className="mt-4 text-xs text-mutedForeground">
          Requires <span className="font-mono">SUPABASE_SERVICE_ROLE_KEY</span> on the server.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card p-5 text-cardForeground">
        <h2 className="text-sm font-semibold">Mock data</h2>
        <p className="mt-1 text-sm text-mutedForeground">
          Generate/enrich fields that aren’t in the Shape KPI export (stages, conditions, closing dates).
        </p>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <form action={generateMockLoanData} className="rounded-md border border-border p-4">
            <div className="text-sm font-medium">Generate mock loans</div>
            <div className="mt-2 flex items-center gap-2">
              <input
                name="count"
                type="number"
                defaultValue={100}
                min={1}
                max={1000}
                className="w-28 rounded-md border border-border bg-background px-2 py-1 text-sm"
              />
              <button
                type="submit"
                className="rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background hover:opacity-90"
              >
                Create
              </button>
            </div>
          </form>

          <form action={mockEnrichImportedLoans} className="rounded-md border border-border p-4">
            <div className="text-sm font-medium">Enrich existing loans</div>
            <div className="mt-2 grid gap-2">
              <label className="text-xs text-mutedForeground">
                Import batch id (optional)
                <input
                  name="importBatchId"
                  type="text"
                  placeholder="uuid"
                  className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
                />
              </label>
              <label className="text-xs text-mutedForeground">
                Limit (optional)
                <input
                  name="limit"
                  type="number"
                  min={1}
                  max={1000}
                  className="mt-1 w-28 rounded-md border border-border bg-background px-2 py-1 text-sm"
                />
              </label>
              <button
                type="submit"
                className="w-fit rounded-md border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-muted"
              >
                Enrich
              </button>
            </div>
          </form>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-5 text-cardForeground">
        <h2 className="text-sm font-semibold">Org setup</h2>
        <p className="mt-1 text-sm text-mutedForeground">
          Seed initial users/teams for demo. Creates auth users with <span className="font-mono">example.invalid</span> emails and a
          shared password.
        </p>
        <form action={seedInitialOrg} className="mt-4">
          <button
            type="submit"
            className="rounded-md border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-muted"
          >
            Seed initial org (demo)
          </button>
        </form>
        <div className="mt-2 text-xs text-mutedForeground">
          Password: <span className="font-mono">ChangeMe!123</span>
        </div>

        <div className="mt-6 border-t border-border pt-5">
          <h3 className="text-sm font-medium">Reset user password</h3>
          <p className="mt-1 text-xs text-mutedForeground">
            Set a new password for any user (e.g. <span className="font-mono">arsalan@questrock.com</span>).
          </p>
          <form action={resetUserPassword} className="mt-3 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs">
              Email
              <input
                name="email"
                type="email"
                placeholder="arsalan@questrock.com"
                className="w-56 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              New password
              <input
                name="password"
                type="password"
                placeholder="••••••••"
                className="w-44 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                required
              />
            </label>
            <button
              type="submit"
              className="rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background hover:opacity-90"
            >
              Reset password
            </button>
          </form>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <form action={createTeam} className="rounded-md border border-border p-4">
            <div className="text-sm font-medium">Create team</div>
            <div className="mt-2 flex items-center gap-2">
              <input
                name="teamName"
                type="text"
                placeholder="Team name"
                className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
                required
              />
              <button
                type="submit"
                className="rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background hover:opacity-90"
              >
                Add
              </button>
            </div>
          </form>

          <form action={createUserAndAssign} className="rounded-md border border-border p-4">
            <div className="text-sm font-medium">Create user (new hire)</div>
            <div className="mt-3 grid gap-2">
              <div className="grid gap-2 md:grid-cols-2">
                <input
                  name="fullName"
                  type="text"
                  placeholder="Full name"
                  className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
                  required
                />
                <input
                  name="email"
                  type="email"
                  placeholder="Email"
                  className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
                  required
                />
              </div>

              <div className="grid gap-2 md:grid-cols-2">
                <select
                  name="role"
                  className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
                  defaultValue="loan_officer"
                >
                  <option value="executive">Executive</option>
                  <option value="manager">Manager</option>
                  <option value="loan_officer">Loan Officer</option>
                  <option value="processor">Processor</option>
                  <option value="closer">Closer</option>
                  <option value="admin">Admin</option>
                </select>

                <input
                  name="password"
                  type="text"
                  defaultValue="ChangeMe!123"
                  className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
                />
              </div>

              <div className="grid gap-2 md:grid-cols-2">
                <select name="teamId" className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm">
                  <option value="">No team</option>
                  {(teams ?? []).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>

                <label className="flex items-center gap-2 text-sm text-mutedForeground">
                  <input name="setAsManager" type="checkbox" className="h-4 w-4" /> Set as team manager
                </label>
              </div>

              <button
                type="submit"
                className="w-fit rounded-md border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-muted"
              >
                Create user
              </button>
            </div>
          </form>
        </div>

        <div className="mt-6 space-y-3">
          <div className="text-sm font-medium">Current users</div>
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr className="text-left text-xs text-mutedForeground">
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Role</th>
                  <th className="px-3 py-2">Team</th>
                </tr>
              </thead>
              <tbody>
                {(users ?? []).map((u) => (
                  <tr key={u.id} className="border-t border-border">
                    <td className="px-3 py-2">{u.full_name}</td>
                    <td className="px-3 py-2">{u.email}</td>
                    <td className="px-3 py-2">{u.role}</td>
                    <td className="px-3 py-2">{u.primary_team_id ? teamNameById.get(u.primary_team_id) ?? "—" : "—"}</td>
                  </tr>
                ))}
                {!users?.length ? (
                  <tr>
                    <td className="px-3 py-6 text-center text-sm text-mutedForeground" colSpan={4}>
                      No users yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

