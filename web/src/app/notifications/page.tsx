"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/Icon";
import { useSession, useToast } from "@/components/providers";
import { PushPrompt } from "@/components/push";
import { AppShell, PageHead } from "@/components/shells";
import { EmptyState, Loaded } from "@/components/ui";
import { api } from "@/lib/api";
import { ago } from "@/lib/format";
import { useNow, useResource } from "@/lib/hooks";
import type { AppNotification } from "@/lib/types";
import s from "./notifications.module.css";

function Row({ item, now, index, unread }: { item: AppNotification; now: number; index: number; unread: boolean }) {
  const body = (
    <>
      <span className={s.icon} aria-hidden="true">
        {item.icon}
      </span>
      <span className={s.text}>
        <span className={s.title}>{item.title}</span>
        <span className={s.when}>{ago(item.at, now)}</span>
      </span>
      {unread && <span className={s.dot} aria-label="New" />}
    </>
  );
  const className = `${s.row} ${unread ? s.unread : ""} rise`;
  const style = { animationDelay: `${Math.min(index, 10) * 50}ms` };
  return item.href ? (
    <Link href={item.href} className={className} style={style}>
      {body}
    </Link>
  ) : (
    <div className={className} style={style}>
      {body}
    </div>
  );
}

function Notifications() {
  const { setUnread } = useSession();
  const toast = useToast();
  const now = useNow();
  const inbox = useResource(() => api.getNotifications(), []);
  // What was new when the page opened stays tinted until "Mark all as read".
  const [cleared, setCleared] = useState(false);
  const fresh = useMemo(
    () => (cleared ? new Set<string>() : new Set(inbox.data?.items.filter((n) => n.unread).map((n) => n.id) ?? [])),
    [inbox.data, cleared],
  );

  // Opening the inbox reads it: the badge on the bell and in the menu clears.
  const unreadOnOpen = inbox.data?.unread ?? 0;
  useEffect(() => {
    if (unreadOnOpen > 0) api.markNotificationsRead().then(() => setUnread(0), () => {});
  }, [unreadOnOpen, setUnread]);

  return (
    <>
      <PageHead
        title="Notifications"
        subtitle="What happened in your pools."
        aside={
          fresh.size > 0 ? (
            <button
              className="icon-btn"
              aria-label="Mark all as read"
              onClick={() => {
                setCleared(true);
                toast("All caught up", "✨");
              }}
            >
              <Icon name="check" />
            </button>
          ) : undefined
        }
      />
      <PushPrompt />
      <Loaded resource={inbox}>
        {(n) =>
          n.items.length ? (
            <div className={s.list}>
              {n.items.map((item, i) => (
                <Row key={item.id} item={item} now={now} index={i} unread={fresh.has(item.id)} />
              ))}
            </div>
          ) : (
            <EmptyState title="You're all caught up">We&apos;ll let you know when something happens in your pools.</EmptyState>
          )
        }
      </Loaded>
    </>
  );
}

export default function Page() {
  return <AppShell>{() => <Notifications />}</AppShell>;
}
