/**
 * Split chat panes (D93). Each pane is an ordinary ChatView; the route thread is the focused pane.
 * Unfocused panes use upstream's BackgroundThreadContext, so their shortcuts stand down while they
 * stay mounted and keep streaming. Everything is keyed by fixed slot, and the focused pane renders
 * the route's own ChatView element at the same position, so moving focus never remounts one.
 */
import { useNavigate } from "@tanstack/react-router";
import { XIcon } from "lucide-react";
import {
  cloneElement,
  useEffect,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
} from "react";

import { useComposerDraftStore } from "../../composerDraftStore";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { cn } from "../../lib/utils";
import { useQuietThreadShell } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import {
  buildDraftThreadRouteParams,
  buildThreadRouteParams,
  type ThreadRouteTarget,
} from "../../threadRoutes";
import ChatView from "../ChatView";
import { BackgroundThreadContext } from "../chat/backgroundThread";
import { Button } from "../ui/button";
import {
  closePane,
  paneGridArea,
  paneTargetKey,
  resolvePaneLayout,
  type PaneSlot,
  type PaneSlotId,
} from "./batonPaneLayout";
import { useBatonPanesStore } from "./batonPanesStore";

type ChatViewElement = ReactElement<{ reserveTitleBarControlInset?: boolean }>;

const KEYBOARD_RESIZE_STEP = 0.02;
const MODIFIER_KEYS = new Set(["Alt", "Control", "Meta", "Shift"]);

function PaneDivider(props: {
  readonly axis: "column" | "row";
  readonly fraction: number;
  readonly style: CSSProperties;
}) {
  const resize = useBatonPanesStore((state) => state.resize);
  const { axis, fraction } = props;
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const grid = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!grid) return;
    resize(
      axis,
      axis === "column"
        ? (event.clientX - grid.left) / grid.width
        : (event.clientY - grid.top) / grid.height,
    );
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const back = axis === "column" ? "ArrowLeft" : "ArrowUp";
    const forward = axis === "column" ? "ArrowRight" : "ArrowDown";
    if (event.key !== back && event.key !== forward) return;
    event.preventDefault();
    resize(axis, fraction + (event.key === back ? -1 : 1) * KEYBOARD_RESIZE_STEP);
  };
  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={axis === "column" ? "Resize panes side to side" : "Resize panes up and down"}
      aria-orientation={axis === "column" ? "vertical" : "horizontal"}
      aria-valuemin={25}
      aria-valuemax={75}
      aria-valuenow={Math.round(fraction * 100)}
      data-testid={`baton-pane-divider-${axis}`}
      className={cn(
        "group absolute z-30 touch-none select-none outline-none",
        axis === "column"
          ? "w-2 -translate-x-1/2 cursor-col-resize"
          : "h-2 -translate-y-1/2 cursor-row-resize",
      )}
      style={props.style}
      onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
      onPointerMove={onPointerMove}
      onKeyDown={onKeyDown}
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute bg-border transition-colors group-hover:bg-primary/50 group-focus-visible:bg-primary",
          axis === "column"
            ? "inset-y-0 left-1/2 w-px -translate-x-1/2"
            : "inset-x-0 top-1/2 h-px -translate-y-1/2",
        )}
      />
    </div>
  );
}

function usePaneThread(target: ThreadRouteTarget) {
  const threadRef = target.kind === "server" ? target.threadRef : null;
  const draftId = target.kind === "draft" ? target.draftId : null;
  const shell = useQuietThreadShell(threadRef);
  const draftSession = useComposerDraftStore((store) =>
    draftId === null ? null : store.getDraftSession(draftId),
  );
  const draftRedirect = useComposerDraftStore((store) =>
    draftId === null ? null : store.getPromotedDraftRedirect(draftId),
  );
  return { shell, draftSession, draftRedirect };
}

function BatonPane(props: {
  readonly slot: PaneSlot;
  readonly index: number;
  readonly count: number;
  readonly focused: boolean;
  readonly background: boolean;
  readonly view: ChatViewElement | null;
  readonly onFocusPane: (target: ThreadRouteTarget) => void;
  readonly onClosePane: (id: PaneSlotId) => void;
}) {
  const { slot, index, count, focused, background, onFocusPane, onClosePane } = props;
  const { target } = slot;
  const { shell, draftSession, draftRedirect } = usePaneThread(target);
  const { environments } = useEnvironments();
  const split = count > 1;
  const environmentId =
    target.kind === "server"
      ? target.threadRef.environmentId
      : (draftSession?.environmentId ?? draftRedirect?.environmentId ?? null);
  const environmentLabel =
    environments.find((environment) => environment.environmentId === environmentId)?.label ?? null;
  // Only the pane under the window controls keeps ChatView's inset for them.
  const reserveTitleBarControlInset = index === Math.min(1, count - 1);

  let view: ReactNode = null;
  if (focused) {
    view = props.view ? cloneElement(props.view, { reserveTitleBarControlInset }) : null;
  } else if (target.kind === "server" && shell !== null) {
    view = (
      <ChatView
        environmentId={target.threadRef.environmentId}
        threadId={target.threadRef.threadId}
        routeKind="server"
        reserveTitleBarControlInset={reserveTitleBarControlInset}
      />
    );
  } else if (target.kind === "draft" && draftSession) {
    view = (
      <ChatView
        key={target.draftId}
        draftId={target.draftId}
        environmentId={draftSession.environmentId}
        threadId={draftSession.threadId}
        routeKind="draft"
        reserveTitleBarControlInset={reserveTitleBarControlInset}
      />
    );
  } else if (draftRedirect) {
    view = (
      <ChatView
        environmentId={draftRedirect.environmentId}
        threadId={draftRedirect.threadId}
        routeKind="server"
        reserveTitleBarControlInset={reserveTitleBarControlInset}
      />
    );
  }

  const title = shell?.title ?? (target.kind === "draft" ? "New thread" : "Thread not available");
  return (
    <section
      aria-label={title}
      data-testid={`baton-pane-${slot.id}`}
      data-focused={focused}
      style={split ? { gridArea: paneGridArea(index, count) } : undefined}
      className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      onPointerDownCapture={() => {
        if (!focused) onFocusPane(target);
      }}
      onKeyDownCapture={(event) => {
        if (!focused && !MODIFIER_KEYS.has(event.key)) onFocusPane(target);
      }}
    >
      <BackgroundThreadContext value={background || !focused}>
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          {view ?? (focused ? null : <PaneUnavailable title={title} />)}
        </div>
      </BackgroundThreadContext>
      {split ? (
        <div
          className={cn(
            "flex h-6 shrink-0 items-center gap-2 border-t px-2 text-xs",
            focused ? "bg-accent/60 text-foreground" : "text-muted-foreground",
          )}
        >
          <span className="min-w-0 flex-1 truncate">{environmentLabel ?? title}</span>
          <Button
            size="icon-micro"
            variant="ghost"
            aria-label={`Close pane: ${title}`}
            data-testid={`baton-pane-close-${slot.id}`}
            onClick={(event) => {
              event.stopPropagation();
              onClosePane(slot.id);
            }}
          >
            <XIcon />
          </Button>
        </div>
      ) : null}
      {split && focused ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 z-20 ring-1 ring-inset ring-primary/40"
        />
      ) : null}
    </section>
  );
}

function PaneUnavailable(props: { readonly title: string }) {
  return (
    <p className="m-auto px-4 text-center text-sm text-muted-foreground">
      {props.title === "Thread not available"
        ? "This thread is on an environment that is not connected, or it was removed."
        : props.title}
    </p>
  );
}

export function BatonPanes(props: {
  readonly route: ThreadRouteTarget;
  readonly background: boolean;
  readonly view: ReactNode;
}) {
  const { route, background } = props;
  const navigate = useNavigate();
  const slots = useBatonPanesStore((state) => state.slots);
  const storedFocus = useBatonPanesStore((state) => state.focusedSlotId);
  const columnFraction = useBatonPanesStore((state) => state.columnFraction);
  const rowFraction = useBatonPanesStore((state) => state.rowFraction);
  const narrow = useMediaQuery("max-lg");
  const lastNavigation = useRef<string | null>(null);

  // Render from the route straight away; the store catches up after commit.
  const layout = resolvePaneLayout({ slots, focusedSlotId: storedFocus }, route);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- records the route's pane in the persisted pane store
  useEffect(() => {
    if (!background) useBatonPanesStore.getState().commitRoute(route);
    lastNavigation.current = null;
  }, [background, route]);

  const goTo = async (target: ThreadRouteTarget) => {
    const key = paneTargetKey(target);
    if (lastNavigation.current === key) return;
    lastNavigation.current = key;
    await (target.kind === "server"
      ? navigate({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams(target.threadRef),
          replace: true,
        })
      : navigate({
          to: "/draft/$draftId",
          params: buildDraftThreadRouteParams(target.draftId),
          replace: true,
        }));
  };
  const closeSlot = (id: PaneSlotId) => {
    const panes = useBatonPanesStore.getState();
    // The route leaves first: a slot closed under the route would hand its thread to a neighbour.
    const { next } = closePane(panes, id);
    if (next) void goTo(next).finally(() => useBatonPanesStore.getState().close(id));
    else panes.close(id);
  };

  const visible = narrow ? layout.slots.filter((s) => s.id === layout.focusedSlotId) : layout.slots;
  const count = visible.length;
  const columnPercent = `${columnFraction * 100}%`;
  const rowPercent = `${rowFraction * 100}%`;
  const style: CSSProperties | undefined =
    count > 1
      ? {
          display: "grid",
          gridTemplateColumns: `minmax(0, ${columnFraction}fr) minmax(0, ${1 - columnFraction}fr)`,
          gridTemplateRows:
            count > 2
              ? `minmax(0, ${rowFraction}fr) minmax(0, ${1 - rowFraction}fr)`
              : "minmax(0, 1fr)",
        }
      : undefined;
  return (
    <div
      data-testid="baton-panes"
      style={style}
      className="relative flex min-h-0 min-w-0 flex-1 flex-col"
    >
      {visible.map((slot, index) => (
        <BatonPane
          key={slot.id}
          slot={slot}
          index={index}
          count={count}
          focused={slot.id === layout.focusedSlotId}
          background={background}
          view={props.view as ChatViewElement | null}
          onFocusPane={(target) => void goTo(target)}
          onClosePane={closeSlot}
        />
      ))}
      {count > 1 ? (
        <PaneDivider
          axis="column"
          fraction={columnFraction}
          style={{
            left: columnPercent,
            top: 0,
            height: count === 3 ? rowPercent : "100%",
          }}
        />
      ) : null}
      {count > 2 ? (
        <PaneDivider
          axis="row"
          fraction={rowFraction}
          style={{ top: rowPercent, left: 0, width: "100%" }}
        />
      ) : null}
    </div>
  );
}
