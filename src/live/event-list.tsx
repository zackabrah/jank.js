import { formatSeconds } from "../format.ts";
import { DisclosureSection } from "../ui/disclosure-section.tsx";
import { eventPosition } from "./events.ts";
import type { LiveView } from "./model.ts";

export function EventList({ events }: { events: LiveView["events"] }) {
  const latest = events?.at(-1);
  const summary = latest
    ? `${latest.label || "Untitled event"} · ${latest.age === null ? "frame age unavailable" : `${formatSeconds(latest.age)} ago`}`
    : events
      ? "No events"
      : "Not supplied";
  return (
    <DisclosureSection title="Events" summary={summary}>
      <div data-live-events>
        {!events?.length ? (
          <p class="py-2 text-label-12 text-jank-text-secondary">
            {events ? "No events reported." : "The host has not supplied events."}
          </p>
        ) : (
          <>
            <p class="py-2 text-label-12 text-jank-text-secondary">
              Latest {events.length} events · times from collector start; ages use the displayed
              frame.
            </p>
            <ol aria-label="Recent events" class="m-0 list-none divide-y divide-jank-divider p-0">
              {events.toReversed().map((event) => (
                <li key={event.id} class="min-w-0 py-2 text-label-12">
                  <p class="wrap-break-word font-medium">{event.label || "Untitled event"}</p>
                  <p class="font-mono text-jank-text-secondary">{eventPosition(event)}</p>
                  {event.detail && (
                    <p class="mt-1 whitespace-pre-wrap wrap-anywhere text-jank-text-secondary">
                      {event.detail}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
    </DisclosureSection>
  );
}
