"use client";

/**
 * Last resort: an error thrown by the root layout itself, which the nested
 * boundaries never see. It has to render its own <html> and <body>, and it
 * cannot rely on the app's providers or fonts having loaded — so the styling
 * here is inline rather than Tailwind on purpose.
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
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0b0d10",
          color: "#e6e8eb",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
          padding: "2rem",
        }}
      >
        <div style={{ maxWidth: "34rem" }}>
          <p
            style={{
              fontFamily: "ui-monospace, SFMono-Regular, monospace",
              fontSize: "0.65rem",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "#f87171",
              margin: 0,
            }}
          >
            SocialOS failed to start
          </p>
          <h1 style={{ fontSize: "1.5rem", margin: "0.75rem 0" }}>
            The application shell didn&rsquo;t render
          </h1>
          <p style={{ color: "#9ba3ae", lineHeight: 1.6, margin: "0 0 1rem" }}>
            This is an error in the root layout, so no page could load. The
            server log has the details; the digest below identifies the entry.
          </p>
          {error.digest && (
            <p
              style={{
                fontFamily: "ui-monospace, SFMono-Regular, monospace",
                fontSize: "0.75rem",
                background: "#15181d",
                border: "1px solid #262b33",
                borderRadius: "0.375rem",
                padding: "0.5rem 0.75rem",
                color: "#9ba3ae",
              }}
            >
              Digest {error.digest}
            </p>
          )}
          <button
            onClick={reset}
            style={{
              marginTop: "1rem",
              background: "#e6e8eb",
              color: "#0b0d10",
              border: 0,
              borderRadius: "0.375rem",
              padding: "0.5rem 1rem",
              fontSize: "0.875rem",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
