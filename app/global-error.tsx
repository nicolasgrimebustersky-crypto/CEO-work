"use client";

/**
 * Last resort: an error thrown in the root layout itself, above the point
 * where app/error.tsx can catch it. Next replaces the whole document here, so
 * this has to render its own <html> and cannot use any of the app's providers
 * or components — hence the inline styles.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1.5rem",
          background: "#0b0e12",
          color: "#f2f5f8",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        <div style={{ maxWidth: "24rem", width: "100%" }}>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 900, margin: "0 0 0.5rem" }}>
            Grime Busters could not start
          </h1>
          <p style={{ margin: "0 0 1rem", color: "#9aa7b4", fontWeight: 600 }}>
            Your data is safe. This is the app failing to load, not a lost record.
          </p>
          <pre
            style={{
              background: "#161b22",
              border: "1px solid #232b34",
              borderRadius: "0.75rem",
              padding: "0.75rem",
              fontSize: "0.85rem",
              whiteSpace: "pre-wrap",
              overflow: "auto",
              maxHeight: "12rem",
            }}
          >
            {error.message || "No error message was provided."}
            {error.digest ? `\n\ndigest: ${error.digest}` : ""}
          </pre>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: "1.25rem",
              width: "100%",
              minHeight: "44px",
              borderRadius: "0.75rem",
              border: "none",
              background: "#22d3ee",
              color: "#06202a",
              fontSize: "1rem",
              fontWeight: 700,
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
