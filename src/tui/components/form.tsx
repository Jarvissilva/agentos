import type { ScrollBoxRenderable, TextareaRenderable } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useEffect, useRef, useState } from "react";
import { colors } from "../theme";
import type { FormSpec } from "../types";
export function Form({
  spec,
  cancel,
  fail,
  error,
  clearError,
  availableWidth,
  availableHeight,
  embedded = false,
  active = true,
}: {
  spec: FormSpec;
  cancel: () => void;
  fail: (error: unknown) => void;
  error?: string;
  clearError?: () => void;
  availableWidth?: number;
  availableHeight?: number;
  embedded?: boolean;
  active?: boolean;
}) {
  const terminal = useTerminalDimensions();
  const width = availableWidth ?? terminal.width;
  const height = availableHeight ?? terminal.height;
  const [values, setValues] = useState(spec.fields.map((field) => field.value));
  const [focus, setFocus] = useState(0);
  const [saving, setSaving] = useState(false);
  const textarea = useRef<TextareaRenderable>(null);
  const fieldsScroll = useRef<ScrollBoxRenderable>(null);
  const formWidth = Math.min(76, width - 2);
  const fieldHeight = Math.max(5, Math.min(9, height - 20));

  useEffect(() => {
    const offset = spec.fields
      .slice(0, focus)
      .reduce((sum, field) => sum + (field.multiline ? fieldHeight : 1) + 2, 0);
    fieldsScroll.current?.scrollTo(offset);
  }, [focus, fieldHeight, spec.fields]);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    clearError?.();
    try {
      await spec.save(values);
    } catch (error) {
      fail(error);
    } finally {
      setSaving(false);
    }
  };

  useKeyboard((key) => {
    if (!active || key.defaultPrevented) return;
    if (key.name === "escape") cancel();
    if (key.name === "tab") {
      key.preventDefault();
      setFocus(
        (index) =>
          (index + (key.shift ? values.length - 1 : 1)) % values.length,
      );
    }
    if (key.ctrl && key.name === "s") {
      key.preventDefault();
      void save();
    }
  });

  return (
    <box flexGrow={1} alignItems="center" justifyContent="center" padding={1}>
      <box
        width={formWidth}
        border={!embedded}
        borderStyle="rounded"
        borderColor={colors.lineBright}
        backgroundColor={colors.panel}
        padding={1}
        maxHeight={height - 2}
        flexDirection="column"
        gap={1}
      >
        <text fg={colors.accentBright}>
          <b>{spec.title}</b>
        </text>
        {spec.subtitle ? <text fg={colors.muted}>{spec.subtitle}</text> : null}
        <scrollbox
          ref={fieldsScroll}
          flexShrink={1}
          scrollbarOptions={{ visible: false }}
        >
          {spec.fields.map((field, index) => (
            <box
              key={field.label}
              flexDirection="column"
              marginBottom={1}
              overflow="hidden"
            >
              <text fg={focus === index ? colors.accent : colors.muted}>
                {`${focus === index ? "❯ " : "  "}${field.label}`}
              </text>
              {field.multiline ? (
                <textarea
                  ref={textarea}
                  initialValue={field.value}
                  height={fieldHeight}
                  focused={active && focus === index && !saving}
                  backgroundColor={colors.panelAlt}
                  focusedBackgroundColor={colors.panelAlt}
                  textColor={colors.textSoft}
                  focusedTextColor={colors.text}
                  placeholderColor={colors.dim}
                  onContentChange={() =>
                    setValues((old) =>
                      old.map((value, position) =>
                        position === index
                          ? (textarea.current?.plainText ?? value)
                          : value,
                      ),
                    )
                  }
                />
              ) : (
                <box
                  height={1}
                  backgroundColor={colors.panelAlt}
                  paddingLeft={1}
                  paddingRight={1}
                >
                  <input
                    width="100%"
                    value={values[index] ?? ""}
                    placeholder=""
                    focused={active && focus === index && !saving}
                    onInput={(text) =>
                      setValues((old) =>
                        old.map((value, position) =>
                          position === index ? text : value,
                        ),
                      )
                    }
                    onSubmit={() => {
                      if (focus < values.length - 1) setFocus(focus + 1);
                      else void save();
                    }}
                    backgroundColor={colors.panelAlt}
                    focusedBackgroundColor={colors.panelAlt}
                    textColor={colors.text}
                    focusedTextColor={colors.text}
                    placeholderColor={colors.faint}
                    cursorColor={colors.accentBright}
                  />
                </box>
              )}
            </box>
          ))}
        </scrollbox>
        {error ? (
          <text fg={colors.error} wrapMode="word">
            {error}
          </text>
        ) : null}
        <text fg={colors.dim}>
          {saving
            ? "Saving…"
            : "Tab next field   ·   Ctrl+S save   ·   Esc cancel"}
        </text>
      </box>
    </box>
  );
}
