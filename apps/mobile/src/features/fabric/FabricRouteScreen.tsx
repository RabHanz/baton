/**
 * The fleet, on the phone.
 *
 * §29 Phase 7 wants the phone to be a supervisor and a voice remote: see all
 * active work, ask what is happening, send an instruction, open the relevant
 * work session. This screen is those four, and it is honest about the two it
 * cannot do — handing work to another account (not built anywhere yet), and a
 * microphone of its own.
 *
 * **There is no custom audio here on purpose.** The iOS keyboard already has a
 * dictation key, and by `docs/fabric/DECISIONS.md` D24 the fork owns everything
 * after the text exists. The Director speaks into the field with the key he
 * already uses, and the sentence goes through the same deterministic grammar
 * as one typed on a laptop. A second speech pipeline would add a permission
 * prompt, a vendor, and a way for the phone to mean something different from
 * the desktop.
 */
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, TextInput, View } from "react-native";
import type { EnvironmentId } from "@t3tools/contracts";

import { useFocusEffect } from "@react-navigation/native";

import { AppText as Text } from "../../components/AppText";
import { ScreenScrollView as ScrollView } from "../../components/ScreenScrollView";
import { useServerConfigs } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { useFabricIntent, useFleet } from "../../state/fabric-work-sessions";
import { SettingsScreen } from "../settings/components/SettingsScreen";
import {
  buildFabricScreenModel,
  fabricAvailability,
  FABRIC_QUICK_ACTIONS,
  handoffAvailability,
} from "./fabricFleetScreenModel";

export function FabricRouteScreen() {
  const { environments } = useEnvironments();
  const serverConfigs = useServerConfigs();

  // The first environment that understands `fabric.*`. A phone talks to
  // several, and calling an older one would be rejected rather than empty.
  const environmentId = useMemo<EnvironmentId | null>(() => {
    for (const environment of environments) {
      const config = serverConfigs.get(environment.environmentId);
      if (config?.environment.capabilities.fabricWorkSessions === true) {
        return environment.environmentId;
      }
    }
    return null;
  }, [environments, serverConfigs]);

  return (
    <SettingsScreen title="Fabric">
      {environmentId === null ? (
        <View className="px-4 py-6">
          <Text className="text-sm text-muted-foreground">
            {fabricAvailability({ capabilityAdvertised: false }).available
              ? ""
              : "No connected environment is running a version with Fabric work sessions."}
          </Text>
        </View>
      ) : (
        <FabricEnvironmentFleet environmentId={environmentId} />
      )}
    </SettingsScreen>
  );
}

function FabricEnvironmentFleet(props: { readonly environmentId: EnvironmentId }) {
  const { entries, loaded } = useFleet(props.environmentId);
  const { resolve, run } = useFabricIntent();
  const [needsUserOnly, setNeedsUserOnly] = useState(false);
  const [text, setText] = useState("");
  const [reply, setReply] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** The reading of the sentence now in the field, shown before it can run. */
  const [reading, setReading] = useState<{
    readonly sentence: string;
    readonly line: string;
    readonly refused: boolean;
  } | null>(null);
  const serverConfigs = useServerConfigs();
  // Staleness is a clock, and a clock read during render freezes at whatever
  // moment the row last rendered — a synopsis would then never *become* stale
  // on screen. The same defect the desktop's fleet section had.
  const [nowMinute, setNowMinute] = useState(() => new Date().toISOString().slice(0, 16));
  useFocusEffect(
    useCallback(() => {
      // The previous value can be hours old when the phone comes back.
      setNowMinute(new Date().toISOString().slice(0, 16));
      const id = setInterval(() => setNowMinute(new Date().toISOString().slice(0, 16)), 60_000);
      return () => clearInterval(id);
    }, []),
  );

  const model = buildFabricScreenModel({
    entries: entries.map((entry) => ({ environmentId: props.environmentId, entry })),
    resolveProjectLabel: () => null,
    resolveEnvironmentLabel: () => null,
    resolveProviderAccount: () => null,
    // `nowMinute` has no offset, so it parses as local rather than UTC unless
    // the zone is made explicit — the same trap the desktop hit.
    now: Date.parse(`${nowMinute}:00Z`),
    needsUserOnly,
  });

  const accountCount =
    serverConfigs.get(props.environmentId)?.providers.filter((provider) => provider.enabled)
      .length ?? 0;
  const handoff = handoffAvailability({ handoffImplemented: false, accountCount });

  /**
   * A quick action is a button whose words the user did not speak, so there is
   * nothing to mishear and nothing to read back.
   */
  const runDirectly = (sentence: string): void => {
    if (busy || sentence.trim().length === 0) return;
    setBusy(true);
    setReply(null);
    setReading(null);
    void run({
      environmentId: props.environmentId,
      text: sentence.trim(),
      focusedWorkSessionId: null,
    }).then((result) => {
      setBusy(false);
      setReply(result.reply);
      setText("");
    });
  };

  /**
   * First submit reads the sentence back; second submit runs it.
   *
   * The desktop bar has worked this way since the model joined the path, and
   * the phone — the surface most likely to mishear a dictated sentence — was
   * the one that acted on the first try.
   */
  const say = (sentence: string): void => {
    const trimmed = sentence.trim();
    if (busy || trimmed.length === 0) return;
    if (reading === null || reading.sentence !== trimmed || reading.refused) {
      setBusy(true);
      setReply(null);
      void resolve({
        environmentId: props.environmentId,
        text: trimmed,
        focusedWorkSessionId: null,
      }).then((result) => {
        setBusy(false);
        setReading({ sentence: trimmed, line: result.line, refused: result.refused });
      });
      return;
    }
    setBusy(true);
    setReply(null);
    void run({
      environmentId: props.environmentId,
      text: trimmed,
      focusedWorkSessionId: null,
    }).then((result) => {
      setBusy(false);
      setReply(result.reply);
      setReading(null);
      setText("");
    });
  };

  return (
    <ScrollView contentContainerClassName="pb-12">
      <View className="flex-row items-center gap-2 px-4 pb-2 pt-3">
        <TextInput
          value={text}
          onChangeText={(next) => {
            setText(next);
            // A reading belongs to the words it read.
            setReading(null);
          }}
          editable={!busy}
          placeholder="What needs me?"
          returnKeyType="send"
          // A dictated sentence is a sentence, and the field has to survive the
          // first submit so the second one can run it.
          autoCapitalize="sentences"
          autoCorrect
          blurOnSubmit={false}
          onSubmitEditing={() => say(text)}
          className="flex-1 rounded-lg bg-muted px-3 py-2 text-base text-foreground"
          accessibilityLabel="Say what you want"
        />
        {busy ? <ActivityIndicator /> : null}
      </View>

      <View className="flex-row flex-wrap gap-2 px-4 pb-2">
        {FABRIC_QUICK_ACTIONS.map((action) => (
          <Pressable
            key={action.sentence}
            onPress={() => runDirectly(action.sentence)}
            className="rounded-full bg-muted px-3 py-1.5"
          >
            <Text className="text-xs text-foreground">{action.label}</Text>
          </Pressable>
        ))}
      </View>

      {reading === null ? null : (
        <View className="px-4 pb-2">
          <Text
            className={
              reading.refused ? "text-sm text-destructive" : "text-sm text-muted-foreground"
            }
          >
            {reading.refused ? reading.line : `Send again to run: ${reading.line}`}
          </Text>
        </View>
      )}

      {reply === null ? null : (
        <View className="px-4 pb-3">
          {/* The spoken reply, as text. Any TTS the phone has can read it; the
              fork does not ship one (D24). */}
          <Text className="text-sm text-foreground">{reply}</Text>
        </View>
      )}

      <View className="flex-row items-center justify-between px-4 pb-1">
        <Text className="text-xs uppercase tracking-wide text-muted-foreground">Fleet</Text>
        <Pressable
          onPress={() => setNeedsUserOnly((current) => !current)}
          accessibilityRole="button"
          accessibilityState={{ selected: needsUserOnly }}
          className="rounded-full px-2 py-1"
        >
          <Text className="text-xs text-foreground">
            {model.needsUserCount === 0 ? "Needs me" : `Needs me · ${model.needsUserCount}`}
          </Text>
        </Pressable>
      </View>

      {!loaded && entries.length === 0 ? (
        <View className="px-4 py-3">
          <ActivityIndicator />
        </View>
      ) : null}

      {model.emptyMessage === null ? null : (
        <View className="px-4 py-3">
          <Text className="text-sm text-muted-foreground">{model.emptyMessage}</Text>
        </View>
      )}

      {model.rows.map((row) => (
        <View key={row.key} className="px-4 py-2">
          <View className="flex-row items-baseline justify-between gap-2">
            <Text className="flex-1 text-sm text-foreground">
              {row.glyph} {row.heading}
            </Text>
            <Text className="text-xs text-muted-foreground">{row.stateLabel}</Text>
          </View>
          {row.attribution === null && row.detail === null ? null : (
            <Text className="text-xs text-muted-foreground">
              {[row.attribution, row.detail].filter((part) => part !== null).join(" · ")}
              {row.detail !== null && row.detailStale ? " (stale)" : ""}
            </Text>
          )}
        </View>
      ))}

      {handoff.available ? null : (
        <View className="px-4 pt-4">
          {/* Named rather than shown as a button that fails when pressed. On a
              phone the user is usually away from the machine that could fix
              it, so the reason has to travel with the refusal. */}
          <Text className="text-xs text-muted-foreground">{handoff.reason}</Text>
        </View>
      )}
    </ScrollView>
  );
}
