"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <div className="mx-auto max-w-lg space-y-4 p-8">
          <h1 className="text-lg font-semibold">Something went wrong</h1>
          <pre className="overflow-auto rounded-md border p-4 text-sm">
            {error.message}
          </pre>
          <button
            type="button"
            onClick={() => reset()}
            className="rounded-md bg-black px-3 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
