import { adminBucket, adminDb } from "@/lib/server/admin";
import { findByShareToken } from "@/lib/server/publicDocument";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Long enough to finish a download on a slow phone; short enough to be useless if forwarded. */
const LINK_MINUTES = 10;

/**
 * A customer downloading a file attached to their estimate or invoice.
 *
 * Authorised the way every customer route is: by the document's share token
 * and nothing else. The storage rules refuse everyone but the crew, so the
 * file cannot be fetched from the bucket directly; this checks the token,
 * finds the file on that document, and redirects to a signed link that
 * expires in minutes.
 *
 * The path is read from the stored document, never from the request, and
 * must sit under that document's own files folder. A request can only name a
 * file id, and only a file on the document its token opens.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string; fileId: string }> },
): Promise<Response> {
  const { token, fileId } = await params;
  const notFound = () => new Response("That file is no longer available.", { status: 404 });

  const found = await findByShareToken(token);
  if (!found) return notFound();

  const { document } = found;
  if (!document.attachments.some((file) => file.id === fileId)) return notFound();

  try {
    const snap = await adminDb().collection("documents").doc(document.id).get();
    const files = Array.isArray(snap.data()?.attachments) ? snap.data()?.attachments : [];
    const file = (files as Record<string, unknown>[]).find((entry) => entry?.id === fileId);
    const path = typeof file?.path === "string" ? file.path : "";
    if (!path.startsWith(`documents/${document.id}/files/`) || path.includes("..")) {
      return notFound();
    }
    const name = (typeof file?.name === "string" && file.name ? file.name : "file").replace(/["\\\r\n]/g, "");

    const [url] = await adminBucket()
      .file(path)
      .getSignedUrl({
        action: "read",
        expires: Date.now() + LINK_MINUTES * 60 * 1000,
        responseDisposition: `attachment; filename="${name}"`,
      });

    return new Response(null, {
      status: 302,
      headers: { Location: url, "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error(`Could not hand out file ${fileId} on document ${document.id}:`, error);
    return new Response("We couldn't fetch that file just now. Please try again.", { status: 503 });
  }
}
