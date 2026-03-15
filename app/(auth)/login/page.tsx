import { sendMagicLink, signInWithPassword } from "./actions";

type Props = {
  searchParams?: { error?: string; checkEmail?: string; redirectTo?: string };
};

export default function LoginPage({ searchParams }: Props) {
  const redirectTo = searchParams?.redirectTo || "/dashboard/lo";

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <div className="rounded-lg border border-border bg-card p-6 text-cardForeground shadow-sm">
        <h1 className="text-lg font-semibold">Sign in</h1>
        <p className="mt-1 text-sm text-mutedForeground">Use email/password or a magic link.</p>

        {searchParams?.error ? (
          <div className="mt-4 rounded-md border border-border bg-muted px-3 py-2 text-sm">{searchParams.error}</div>
        ) : null}
        {searchParams?.checkEmail ? (
          <div className="mt-4 rounded-md border border-border bg-muted px-3 py-2 text-sm">
            Check your email for a sign-in link.
          </div>
        ) : null}

        <form action={signInWithPassword} className="mt-6 space-y-3">
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <label className="block text-sm">
            <div className="mb-1 text-mutedForeground">Email</div>
            <input
              name="email"
              type="email"
              required
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-foreground/20"
            />
          </label>
          <label className="block text-sm">
            <div className="mb-1 text-mutedForeground">Password</div>
            <input
              name="password"
              type="password"
              required
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-foreground/20"
            />
          </label>
          <button
            type="submit"
            className="w-full rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background hover:opacity-90"
          >
            Sign in
          </button>
        </form>

        <div className="my-6 flex items-center gap-3">
          <div className="h-px flex-1 bg-border" />
          <div className="text-xs text-mutedForeground">or</div>
          <div className="h-px flex-1 bg-border" />
        </div>

        <form action={sendMagicLink} className="space-y-3">
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <label className="block text-sm">
            <div className="mb-1 text-mutedForeground">Email</div>
            <input
              name="email"
              type="email"
              required
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-foreground/20"
            />
          </label>
          <button
            type="submit"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-muted"
          >
            Send magic link
          </button>
        </form>
      </div>
    </div>
  );
}

