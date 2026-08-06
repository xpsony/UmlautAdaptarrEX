"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import type { ProviderId } from "@/schemas/instance";
import { cn } from "@/lib/utils";

interface ProviderOrderFieldProps {
  value: ProviderId[];
  onChange: (next: ProviderId[]) => void;
  /** Pool of all available providers, including ones not yet in `value`. */
  available: readonly ProviderId[];
}

/**
 * Drag-and-drop list of title providers for an instance. Reorder-only
 * control; add/remove goes through the checkboxes at the end of each row.
 * Built on @dnd-kit with a keyboard sensor (Tab -> arrow keys to sort).
 */
export function ProviderOrderField({ value, onChange, available }: ProviderOrderFieldProps) {
  const t = useTranslations("instances");
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  function handleDragEnd(event: DragEndEvent): void {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = value.indexOf(active.id as ProviderId);
    const newIndex = value.indexOf(over.id as ProviderId);
    if (oldIndex < 0 || newIndex < 0) return;
    onChange(arrayMove(value, oldIndex, newIndex));
  }

  function toggle(id: ProviderId, enabled: boolean): void {
    if (enabled && !value.includes(id)) {
      onChange([...value, id]);
    } else if (!enabled && value.includes(id)) {
      const next = value.filter((v) => v !== id);
      // At least one provider must stay enabled or the instance can't sync,
      // because Composite would otherwise be empty.
      if (next.length === 0) return;
      onChange(next);
    }
  }

  const inactive = available.filter((id) => !value.includes(id));

  return (
    <div className="space-y-2">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={value} strategy={verticalListSortingStrategy}>
          <ul className="space-y-1.5 rounded-md border bg-card p-1.5">
            {value.map((id, idx) => (
              <SortableProviderRow
                key={id}
                id={id}
                index={idx}
                onRemove={value.length > 1 ? () => toggle(id, false) : undefined}
                t={t}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      {inactive.length > 0 ? (
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="text-muted-foreground">{t("providerAdd")}:</span>
          {inactive.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => toggle(id, true)}
              aria-label={t("providerAddAria", { name: t(`providerOption.${id}`) })}
              className="rounded-full border bg-background px-2 py-0.5 hover:bg-accent"
            >
              + {t(`providerOption.${id}`)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

interface SortableProviderRowProps {
  id: ProviderId;
  index: number;
  onRemove?: (() => void) | undefined;
  t: ReturnType<typeof useTranslations<"instances">>;
}

function SortableProviderRow({ id, index, onRemove, t }: SortableProviderRowProps) {
  const dragHandleId = useId();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-2 rounded-sm bg-background px-2 py-1.5",
        isDragging && "opacity-60 shadow-lg",
      )}
    >
      <button
        type="button"
        aria-labelledby={dragHandleId}
        className="-ml-1 flex h-7 w-7 cursor-grab touch-none items-center justify-center rounded text-muted-foreground hover:bg-accent active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <span id={dragHandleId} className="sr-only">
        {t("providerDragHandle", { name: t(`providerOption.${id}`) })}
      </span>
      <span className="flex-1 text-sm font-medium">
        {index + 1}. {t(`providerOption.${id}`)}
      </span>
      {id === "pcjones" ? (
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
          {t("providerBadge.deOnly")}
        </span>
      ) : null}
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={t("providerRemoveAria", { name: t(`providerOption.${id}`) })}
          className="text-xs text-muted-foreground hover:text-destructive"
        >
          {t("providerRemove")}
        </button>
      ) : null}
    </li>
  );
}
