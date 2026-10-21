"use client";

import { useParams, useRouter } from "next/navigation";
import { Suspense, useState } from "react";
import { confettiFrom, flyPlane } from "@/components/motion";
import { sound } from "@/lib/sound";
import { EntryList, ImportOptions, usable } from "@/components/people";
import { useToast } from "@/components/providers";
import { AppShell, PageHead } from "@/components/shells";
import { BusyButton, EmptyState, ErrorText, Loaded } from "@/components/ui";
import { api } from "@/lib/api";
import { useAction, useResource } from "@/lib/hooks";
import type { Entry } from "@/lib/people";

function AddDivers() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const pool = useResource(() => api.getPool(id), [id]);
  const add = useAction(api.addDivers);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [source, setSource] = useState("");

  return (
    <Loaded resource={pool}>
      {(p) => {
        const ready = usable(entries);
        return (
          <>
            <PageHead back={`/pools/${id}`} title="Add divers" subtitle={`${p.name}. Only you, the lifeguard, can add people directly.`} />
            {p.role !== "lifeguard" ? (
              <p className="note">Only the lifeguard can add people to this pool.</p>
            ) : (
              <div className="grid-side">
                <div style={{ display: "grid", gap: 10 }}>
                  <ImportOptions
                    existing={p.divers.map((d) => ({ name: d.name, contact: d.contact }))}
                    onAdd={(found, from) => {
                      setEntries(found);
                      setSource(from);
                    }}
                  />
                  <p className="t-small muted">Emails get the invite straight away. People added by phone see it the next time they sign in. No SMS is sent.</p>
                </div>
                <div style={{ display: "grid", gap: 12 }}>
                  {entries.length ? (
                    <>
                      <EntryList entries={entries} title={source} />
                      <BusyButton
                        busy={add.busy}
                        disabled={!ready.length}
                        className="btn btn-primary btn-block"
                        onClick={async (e) => {
                          const button = e.currentTarget;
                          const done = await add.run(p.id, ready.map(({ name, contact }) => ({ name, contact })));
                          if (done.ok) {
                            // Invites fly off, with a burst of confetti.
                            flyPlane(button);
                            confettiFrom(button.parentElement, 40, 0.5, 0.2);
                            sound.big();
                            toast(`${ready.length} people added`, "✨");
                            router.push(`/pools/${p.id}`);
                          }
                        }}
                      >
                        Invite {ready.length} {ready.length === 1 ? "person" : "people"}
                      </BusyButton>
                      <ErrorText error={add.error} />
                    </>
                  ) : (
                    <EmptyState title="Add your group">Pick contacts, paste a list or upload a file. You&apos;ll see who&apos;s ready before anyone is added.</EmptyState>
                  )}
                </div>
              </div>
            )}
          </>
        );
      }}
    </Loaded>
  );
}

export default function Page() {
  return (
    <AppShell>
      {() => (
        <Suspense>
          <AddDivers />
        </Suspense>
      )}
    </AppShell>
  );
}
