/**
 * Split chat panes (D93). The route thread is the focused pane; unfocused panes stay mounted under
 * BackgroundThreadContext, so their shortcuts and window-level controls stand down. Panes are flat
 * siblings keyed by slot and placed by rects, so neither focus nor a rearrange remounts a ChatView.
 */
import { useNavigate } from "@tanstack/react-router";
import { ExternalLinkIcon, GripVerticalIcon, PanelLeftCloseIcon, XIcon } from "lucide-react";
import {
  cloneElement,
  useEffect,
  useRef,
  useState,
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
import { toastManager } from "../ui/toast";
import {
  closePane,
  fitPaneTree,
  MIN_PANE_FRACTION,
  paneDividers,
  paneDropZone,
  paneNeighbour,
  paneRects,
  paneTargetKey,
  resolvePaneLayout,
  type PaneBox,
  type PaneDivider,
  type PaneDropZone,
  type PaneEdge,
  type PaneSlot,
  type PaneSlotId,
} from "./batonPaneLayout";
import { useBatonPanesStore } from "./batonPanesStore";
import {
  batonWindowId,
  MAIN_WINDOW_ID,
  onAttachRequest,
  openDetachedWindow,
  requestAttach,
} from "./batonWindows";

type ChatViewElement = ReactElement<{ reserveTitleBarControlInset?: boolean }>;

const KEYBOARD_RESIZE_STEP = 0.02;
const MODIFIER_KEYS = new Set(["Alt", "Control", "Meta", "Shift"]);
const PANE_DRAG_TYPE = "application/x-baton-pane";
const WHOLE_BOX: PaneBox = { left: 0, top: 0, width: 1, height: 1 };
const ARROW_EDGES: Readonly<Record<string, PaneEdge>> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "top",
  ArrowDown: "bottom",
};
const percent = (fraction: number) => `${fraction * 100}%`;
const boxStyle = (box: PaneBox): CSSProperties => ({
  left: percent(box.left),
  top: percent(box.top),
  width: percent(box.width),
  height: percent(box.height),
});

function PaneDividerHandle(props: { readonly divider: PaneDivider }) {
  const { path, index, dir, box, at } = props.divider;
  const resize = useBatonPanesStore((state) => state.resize);
  const row = dir === "row";
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const grid = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!grid) return;
    resize(
      path,
      index,
      row
        ? ((event.clientX - grid.left) / grid.width - box.left) / box.width
        : ((event.clientY - grid.top) / grid.height - box.top) / box.height,
    );
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const back = row ? "ArrowLeft" : "ArrowUp";
    const forward = row ? "ArrowRight" : "ArrowDown";
    if (event.key !== back && event.key !== forward) return;
    event.preventDefault();
    resize(path, index, at + (event.key === back ? -1 : 1) * KEYBOARD_RESIZE_STEP);
  };
  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={row ? "Resize panes side to side" : "Resize panes up and down"}
      aria-orientation={row ? "vertical" : "horizontal"}
      aria-valuemin={Math.round(MIN_PANE_FRACTION * 100)}
      aria-valuemax={Math.round((1 - MIN_PANE_FRACTION) * 100)}
      aria-valuenow={Math.round(at * 100)}
      data-testid={`baton-pane-divider-${row ? "column" : "row"}`}
      className={cn(
        "group absolute z-30 touch-none select-none outline-none",
        row ? "w-2 -translate-x-1/2 cursor-col-resize" : "h-2 -translate-y-1/2 cursor-row-resize",
      )}
      style={
        row
          ? {
              left: percent(box.left + at * box.width),
              top: percent(box.top),
              height: percent(box.height),
            }
          : {
              top: percent(box.top + at * box.height),
              left: percent(box.left),
              width: percent(box.width),
            }
      }
      onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
      onPointerMove={onPointerMove}
      onKeyDown={onKeyDown}
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute bg-border transition-colors group-hover:bg-primary/50 group-focus-visible:bg-primary",
          row
            ? "inset-y-0 left-1/2 w-px -translate-x-1/2"
            : "inset-x-0 top-1/2 h-px -translate-y-1/2",
        )}
      />
    </div>
  );
}

const DROP_HINT: Readonly<Record<PaneDropZone, CSSProperties>> = {
  center: { inset: 0 },
  left: { inset: "0 50% 0 0" },
  right: { inset: "0 0 0 50%" },
  top: { inset: "0 0 50% 0" },
  bottom: { inset: "50% 0 0 0" },
};

/** Sits over one pane while another is being dragged, so the drag never reaches its ChatView. */
function PaneDropTarget(props: {
  readonly id: PaneSlotId;
  readonly box: PaneBox;
  readonly onDrop: (zone: PaneDropZone) => void;
}) {
  const [zone, setZone] = useState<PaneDropZone | null>(null);
  return (
    <div
      data-testid={`baton-pane-drop-${props.id}`}
      className="absolute z-40"
      style={boxStyle(props.box)}
      onDragOver={(event) => {
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        setZone(
          paneDropZone(
            (event.clientX - rect.left) / rect.width,
            (event.clientY - rect.top) / rect.height,
          ),
        );
      }}
      onDragLeave={() => setZone(null)}
      onDrop={(event) => {
        event.preventDefault();
        if (zone !== null) props.onDrop(zone);
      }}
    >
      {zone === null ? null : (
        <span
          aria-hidden
          className="pointer-events-none absolute rounded-sm bg-primary/20 ring-1 ring-inset ring-primary/60"
          style={DROP_HINT[zone]}
        />
      )}
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
  readonly box: PaneBox;
  readonly count: number;
  readonly focused: boolean;
  readonly background: boolean;
  readonly elsewhere: boolean;
  readonly detached: boolean;
  readonly view: ChatViewElement | null;
  readonly onFocusPane: (target: ThreadRouteTarget) => void;
  readonly onClosePane: (id: PaneSlotId) => void;
  readonly onDetachPane: (slot: PaneSlot) => void;
  readonly onAttachPane: (slot: PaneSlot) => void;
  readonly onBringHere: (target: ThreadRouteTarget) => void;
  readonly onDragChange: (id: PaneSlotId | null) => void;
  readonly onMovePane: (id: PaneSlotId, edge: PaneEdge, toWindowEdge: boolean) => void;
}) {
  const { slot, box, count, focused, background, elsewhere, detached } = props;
  const { onFocusPane, onClosePane, onDetachPane, onAttachPane, onBringHere } = props;
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
  const reserveTitleBarControlInset = box.top === 0 && box.left + box.width > 0.999;

  let view: ReactNode = null;
  if (elsewhere) {
    view = <PaneElsewhere onBringHere={() => onBringHere(target)} />;
  } else if (focused) {
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
      style={split ? { position: "absolute", ...boxStyle(box) } : undefined}
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
      {split || detached ? (
        <div
          draggable={split}
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData(PANE_DRAG_TYPE, slot.id);
            props.onDragChange(slot.id);
          }}
          onDragEnd={() => props.onDragChange(null)}
          data-testid={`baton-pane-bar-${slot.id}`}
          className={cn(
            "flex h-6 shrink-0 items-center gap-2 border-t px-2 text-xs",
            split && "cursor-grab active:cursor-grabbing",
            focused ? "bg-accent/60 text-foreground" : "text-muted-foreground",
          )}
        >
          {split ? (
            <Button
              size="icon-micro"
              variant="ghost"
              aria-label={`Move pane: ${title}. Arrow keys swap it with a neighbour, Shift and an arrow gives it that whole side`}
              data-testid={`baton-pane-move-${slot.id}`}
              onKeyDown={(event) => {
                const edge = ARROW_EDGES[event.key];
                if (edge === undefined) return;
                event.preventDefault();
                event.stopPropagation();
                props.onMovePane(slot.id, edge, event.shiftKey);
              }}
            >
              <GripVerticalIcon />
            </Button>
          ) : null}
          <span className="min-w-0 flex-1 truncate">{environmentLabel ?? title}</span>
          {detached ? (
            <Button
              size="icon-micro"
              variant="ghost"
              aria-label={`Attach to main window: ${title}`}
              data-testid={`baton-pane-attach-${slot.id}`}
              onClick={() => onAttachPane(slot)}
            >
              <PanelLeftCloseIcon />
            </Button>
          ) : null}
          {split ? (
            <Button
              size="icon-micro"
              variant="ghost"
              aria-label={`Detach to window: ${title}`}
              data-testid={`baton-pane-detach-${slot.id}`}
              onClick={() => onDetachPane(slot)}
            >
              <ExternalLinkIcon />
            </Button>
          ) : null}
          {split ? (
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
          ) : null}
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

function PaneElsewhere(props: { readonly onBringHere: () => void }) {
  return (
    <div className="m-auto flex flex-col items-center gap-2 px-4 text-center text-sm text-muted-foreground">
      <p>This thread is open in another window.</p>
      <Button
        size="xs"
        variant="outline"
        data-testid="baton-pane-bring-here"
        onClick={props.onBringHere}
      >
        Bring it here
      </Button>
    </div>
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
  const storedTree = useBatonPanesStore((state) => state.tree);
  const arranged = useBatonPanesStore((state) => state.arranged);
  const ceded = useBatonPanesStore((state) => state.ceded);
  const narrow = useMediaQuery("max-lg");
  const [dragging, setDragging] = useState<PaneSlotId | null>(null);
  const lastNavigation = useRef<string | null>(null);
  const routeRef = useRef(route);
  const detached = batonWindowId() !== MAIN_WINDOW_ID;

  // Render from the route straight away; the store catches up after commit.
  const layout = resolvePaneLayout({ slots, focusedSlotId: storedFocus }, route);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- records the route's pane in the persisted pane store
  useEffect(() => {
    routeRef.current = route;
    if (!background) useBatonPanesStore.getState().commitRoute(route);
    lastNavigation.current = null;
  }, [background, route]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to threads handed back by detached windows
  useEffect(
    () =>
      onAttachRequest((target) => {
        useBatonPanesStore.getState().open(routeRef.current, target);
      }),
    [],
  );

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
  const detachSlot = (slot: PaneSlot) => {
    if (!openDetachedWindow(slot.target)) {
      toastManager.add({
        type: "error",
        title: "The browser blocked the new window",
        description: "Allow popups for this site, then detach again.",
      });
      return;
    }
    if (useBatonPanesStore.getState().slots.length > 1) closeSlot(slot.id);
  };
  const attachSlot = (slot: PaneSlot) => {
    void requestAttach(slot.target).then((attached) => {
      if (!attached) {
        toastManager.add({ type: "error", title: "The main window is not open on a thread" });
      } else if (useBatonPanesStore.getState().slots.length > 1) {
        closeSlot(slot.id);
      } else {
        window.close();
      }
    });
  };

  const visible = narrow ? layout.slots.filter((s) => s.id === layout.focusedSlotId) : layout.slots;
  const count = visible.length;
  const tree = narrow
    ? (visible[0]?.id ?? null)
    : fitPaneTree(
        storedTree,
        arranged,
        visible.map((slot) => slot.id),
      );
  const rects = paneRects(tree);
  const moveSlot = (id: PaneSlotId, edge: PaneEdge, toWindowEdge: boolean) => {
    const panes = useBatonPanesStore.getState();
    if (toWindowEdge) return panes.dockToEdge(id, edge);
    const neighbour = paneNeighbour(rects, id, edge);
    if (neighbour !== null) panes.dock(id, neighbour, "center");
  };
  return (
    <div data-testid="baton-panes" className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      {visible.map((slot) => (
        <BatonPane
          key={slot.id}
          slot={slot}
          box={rects.find((rect) => rect.id === slot.id)?.box ?? WHOLE_BOX}
          count={count}
          focused={slot.id === layout.focusedSlotId}
          background={background}
          elsewhere={ceded.includes(paneTargetKey(slot.target))}
          detached={detached}
          view={props.view as ChatViewElement | null}
          onFocusPane={(target) => void goTo(target)}
          onClosePane={closeSlot}
          onDetachPane={detachSlot}
          onAttachPane={attachSlot}
          onBringHere={(target) => useBatonPanesStore.getState().claim(target)}
          onDragChange={setDragging}
          onMovePane={moveSlot}
        />
      ))}
      {dragging === null
        ? null
        : rects
            .filter((rect) => rect.id !== dragging)
            .map((rect) => (
              <PaneDropTarget
                key={rect.id}
                id={rect.id}
                box={rect.box}
                onDrop={(zone) => {
                  useBatonPanesStore.getState().dock(dragging, rect.id, zone);
                  setDragging(null);
                }}
              />
            ))}
      {paneDividers(tree).map((divider) => (
        <PaneDividerHandle key={`${divider.path.join(".")}:${divider.index}`} divider={divider} />
      ))}
    </div>
  );
}
