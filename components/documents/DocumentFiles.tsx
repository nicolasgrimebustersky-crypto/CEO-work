"use client";

import { useRef, useState } from "react";

import { useTeam } from "@/components/providers/TeamProvider";
import { Button } from "@/components/ui/Button";
import { attachFile, attachmentProblem, crewFileUrl, removeFile } from "@/lib/db/attachments";
import type { BusinessDocument } from "@/lib/documents";
import { AttachedFiles } from "./AttachedFiles";

/**
 * The crew's side of attached files: add a PDF or photo, open one, remove
 * one. The customer sees the same tiles on their copy, under the document.
 */
export function DocumentFiles({ document }: { document: BusinessDocument }) {
  const { author } = useTeam();
  const input = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState("");

  const add = async (files: FileList | null) => {
    if (!author || !files || files.length === 0) return;
    setError("");
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const problem = attachmentProblem(file);
        if (problem) {
          setError(`${file.name}: ${problem}`);
          continue;
        }
        await attachFile(document, file, author);
      }
    } catch {
      setError("Could not attach that file. Check your signal and try again.");
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-lg font-bold text-ink">Attached files</h2>
        <Button variant="secondary" onClick={() => input.current?.click()} disabled={uploading}>
          {uploading ? "Attaching…" : "Attach file"}
        </Button>
        <input
          ref={input}
          type="file"
          multiple
          accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif"
          className="hidden"
          onChange={(event) => void add(event.target.files)}
        />
      </div>

      {document.attachments.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface-2 px-3 py-3 text-sm font-semibold text-muted">
          A scope of work, your certificate of insurance, a site photo — anything attached here shows
          on the customer&rsquo;s copy as a download.
        </p>
      ) : (
        <AttachedFiles
          files={document.attachments}
          hrefFor={() => null}
          action="Open"
          busyId={removing}
          onOpen={(file) => {
            const attachment = document.attachments.find((entry) => entry.id === file.id);
            if (!attachment) return;
            // Opened before the await so the browser treats it as a tap, not a popup.
            const tab = window.open("", "_blank");
            void crewFileUrl(attachment)
              .then((url) => {
                if (tab && url) tab.location.href = url;
                else tab?.close();
              })
              .catch(() => {
                tab?.close();
                setError("Could not open that file.");
              });
          }}
          onRemove={(file) => {
            const attachment = document.attachments.find((entry) => entry.id === file.id);
            if (!attachment || !author) return;
            setRemoving(file.id);
            void removeFile(document, attachment, author)
              .catch(() => setError("Could not remove that file."))
              .finally(() => setRemoving(null));
          }}
        />
      )}

      {error ? (
        <p role="alert" className="mt-2 rounded-xl border border-danger/60 bg-danger/15 px-3 py-2.5 text-sm font-semibold text-ink">
          {error}
        </p>
      ) : null}
    </section>
  );
}
