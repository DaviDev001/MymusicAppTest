import React, { useEffect, useState } from 'react';
import {
  View, Text, FlatList, Pressable, Image, Modal, TextInput, Alert,
  StyleSheet, StatusBar, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Slider from '@react-native-community/slider';
import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayer, useAudioPlayerStatus, setAudioModeAsync } from 'expo-audio';

const C = {
  bg: '#0e2427', surface: '#16363a', surface2: '#1f4549', text: '#eef2ea',
  muted: '#93b0aa', accent: '#f4b43c', onAccent: '#1b1405', danger: '#ff8a73',
};
const AUDIO_DIR = FileSystem.documentDirectory + 'audio/';
const COVER_DIR = FileSystem.documentDirectory + 'covers/';
const KEY_TRACKS = 'tracks-v1';
const KEY_REPEAT = 'repeat-v1';
const REP_NEXT = { off: 'one', one: 'all', all: 'off' };
const REP_LABEL = { off: 'Repetição desligada', one: 'Repetindo esta música', all: 'Repetindo todas' };

const fmtTime = (s) => {
  if (!isFinite(s) || s < 0) return '0:00';
  const t = Math.floor(s);
  return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
};
const hueOf = (name = '?') => {
  let h = 0;
  for (const ch of name.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
};
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const extOf = (n = '') => { const m = n.match(/\.[A-Za-z0-9]{1,5}$/); return m ? m[0] : '.mp3'; };
const baseName = (n = '') => n.replace(/\.[^.]+$/, '') || 'Sem nome';

function Cover({ track, size, radius = 10 }) {
  if (track?.cover) {
    return <Image source={{ uri: track.cover }} style={{ width: size, height: size, borderRadius: radius, backgroundColor: C.surface2 }} />;
  }
  const h = hueOf(track?.name);
  return (
    <View style={{
      width: size, height: size, borderRadius: radius, alignItems: 'center', justifyContent: 'center',
      backgroundColor: `hsl(${h}, 45%, 30%)`,
    }}>
      <Text style={{ color: 'rgba(255,255,255,.9)', fontSize: size * 0.45, fontWeight: '700' }}>
        {(track?.name || '♪').trim().charAt(0).toUpperCase() || '♪'}
      </Text>
    </View>
  );
}

function IconBtn({ name, onPress, size = 24, color = C.text, style, label }) {
  return (
    <Pressable onPress={onPress} accessibilityLabel={label} hitSlop={6}
      style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.6 }, style]}>
      <Ionicons name={name} size={size} color={color} />
    </Pressable>
  );
}

function Main() {
  const insets = useSafeAreaInsets();
  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);

  const [tracks, setTracks] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [currentId, setCurrentId] = useState(null);
  const [repeat, setRepeat] = useState('off');
  const [seekVal, setSeekVal] = useState(null);
  const [editing, setEditing] = useState(null); // {id, name, cover}

  const current = tracks.find((t) => t.id === currentId) || null;

  // Inicialização: modo de áudio (segundo plano) + carregar biblioteca salva
  useEffect(() => {
    (async () => {
      try {
        await setAudioModeAsync({
          playsInSilentMode: true,
          shouldPlayInBackground: true,
          interruptionMode: 'doNotMix',
        });
      } catch (e) {}
      try {
        await FileSystem.makeDirectoryAsync(AUDIO_DIR, { intermediates: true });
        await FileSystem.makeDirectoryAsync(COVER_DIR, { intermediates: true });
      } catch (e) {}
      try {
        const raw = await AsyncStorage.getItem(KEY_TRACKS);
        if (raw) setTracks(JSON.parse(raw));
        const r = await AsyncStorage.getItem(KEY_REPEAT);
        if (r && REP_LABEL[r]) setRepeat(r);
      } catch (e) {}
      setLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (loaded) AsyncStorage.setItem(KEY_TRACKS, JSON.stringify(tracks)).catch(() => {});
  }, [tracks, loaded]);

  useEffect(() => {
    if (loaded) AsyncStorage.setItem(KEY_REPEAT, repeat).catch(() => {});
    try { player.loop = repeat === 'one'; } catch (e) {}
  }, [repeat, loaded]);

  // Quando a música termina (sem repetir uma só)
  useEffect(() => {
    if (status.didJustFinish && repeat !== 'one') nextTrack(true);
  }, [status.didJustFinish]);

  const setLock = (t) => {
    try {
      player.setActiveForLockScreen(true, {
        title: t.name, artist: 'Meu Player', albumTitle: 'Offline', artworkUrl: t.cover || undefined,
      });
    } catch (e) {}
  };

  const playTrack = (id) => {
    const t = tracks.find((x) => x.id === id);
    if (!t) return;
    setCurrentId(id);
    setSeekVal(null);
    try {
      player.replace({ uri: t.uri });
      player.loop = repeat === 'one';
      player.play();
      setLock(t);
    } catch (e) {
      Alert.alert('Erro', 'Não foi possível tocar esta música.');
    }
  };

  const nextTrack = (auto = false) => {
    if (!tracks.length) return;
    const i = tracks.findIndex((t) => t.id === currentId);
    if (i < 0) return playTrack(tracks[0].id);
    if (i + 1 < tracks.length) return playTrack(tracks[i + 1].id);
    if (!auto || repeat === 'all') return playTrack(tracks[0].id);
    player.pause();
    player.seekTo(0);
  };

  const prevTrack = () => {
    if (!tracks.length) return;
    if (status.currentTime > 3) { player.seekTo(0); return; }
    const i = tracks.findIndex((t) => t.id === currentId);
    playTrack(tracks[i > 0 ? i - 1 : tracks.length - 1].id);
  };

  const togglePlay = () => {
    if (!current) { if (tracks.length) playTrack(tracks[0].id); return; }
    if (status.playing) player.pause(); else player.play();
  };

  const addFiles = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: 'audio/*', multiple: true, copyToCacheDirectory: true,
      });
      if (res.canceled) return;
      const added = [];
      for (const a of res.assets) {
        const id = newId();
        const dest = AUDIO_DIR + id + extOf(a.name);
        await FileSystem.copyAsync({ from: a.uri, to: dest });
        added.push({ id, name: baseName(a.name), uri: dest, cover: null, size: a.size || 0 });
      }
      setTracks((prev) => [...prev, ...added]);
    } catch (e) {
      Alert.alert('Erro', 'Não foi possível adicionar os arquivos.');
    }
  };

  const pickCover = async () => {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.8,
      });
      if (res.canceled) return;
      const dest = COVER_DIR + editing.id + '-' + Date.now() + '.jpg';
      await FileSystem.copyAsync({ from: res.assets[0].uri, to: dest });
      setEditing((e) => ({ ...e, cover: dest }));
    } catch (e) {
      Alert.alert('Erro', 'Não foi possível usar esta imagem.');
    }
  };

  const saveEdit = async () => {
    const old = tracks.find((t) => t.id === editing.id);
    if (!old) return setEditing(null);
    const updated = { ...old, name: editing.name.trim() || old.name, cover: editing.cover };
    if (old.cover && old.cover !== updated.cover) {
      FileSystem.deleteAsync(old.cover, { idempotent: true }).catch(() => {});
    }
    setTracks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    if (updated.id === currentId) setLock(updated);
    setEditing(null);
  };

  const deleteTrack = () => {
    const t = tracks.find((x) => x.id === editing.id);
    if (!t) return;
    Alert.alert('Excluir música?', t.name, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Excluir', style: 'destructive',
        onPress: async () => {
          if (t.id === currentId) {
            try { player.pause(); player.clearLockScreenControls(); } catch (e) {}
            setCurrentId(null);
          }
          await FileSystem.deleteAsync(t.uri, { idempotent: true }).catch(() => {});
          if (t.cover) await FileSystem.deleteAsync(t.cover, { idempotent: true }).catch(() => {});
          setTracks((prev) => prev.filter((x) => x.id !== t.id));
          setEditing(null);
        },
      },
    ]);
  };

  const panelH = current ? 210 + insets.bottom : 0;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.h1}>Minhas músicas</Text>
          {tracks.length > 0 && (
            <Text style={styles.muted}>
              {tracks.length} {tracks.length === 1 ? 'música salva' : 'músicas salvas'} neste aparelho
            </Text>
          )}
        </View>
        <Pressable onPress={addFiles} style={styles.addBtn} accessibilityLabel="Adicionar músicas">
          <Ionicons name="add" size={20} color={C.onAccent} />
          <Text style={styles.addTxt}>Adicionar</Text>
        </Pressable>
      </View>

      <FlatList
        data={tracks}
        keyExtractor={(t) => t.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: panelH + 24, gap: 6 }}
        ListEmptyComponent={
          loaded ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>Sua biblioteca está vazia</Text>
              <Text style={styles.emptyTxt}>
                Escolha arquivos de áudio do celular. Eles ficam salvos no app e tocam sem internet.
              </Text>
              <Pressable onPress={addFiles} style={[styles.addBtn, { alignSelf: 'center', marginTop: 14 }]}>
                <Text style={styles.addTxt}>Escolher arquivos de áudio</Text>
              </Pressable>
            </View>
          ) : null
        }
        renderItem={({ item }) => {
          const isCur = item.id === currentId;
          return (
            <View style={[styles.row, isCur && { borderLeftColor: C.accent, borderLeftWidth: 3 }]}>
              <Pressable
                style={styles.rowMain}
                onPress={() => (isCur ? togglePlay() : playTrack(item.id))}
              >
                <Cover track={item} size={52} radius={8} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
                  <Text style={[styles.sub, isCur && { color: C.accent }]}>
                    {isCur ? (status.playing ? 'Tocando agora' : 'Pausada') : 'Toque para ouvir'}
                  </Text>
                </View>
              </Pressable>
              <IconBtn
                name="create-outline" color={C.muted} label={'Editar ' + item.name}
                onPress={() => setEditing({ id: item.id, name: item.name, cover: item.cover })}
              />
            </View>
          );
        }}
      />

      {current && (
        <View style={[styles.panel, { paddingBottom: 14 + insets.bottom }]}>
          <View style={styles.panelTop}>
            <Cover track={current} size={56} radius={10} />
            <View style={{ flex: 1 }}>
              <Text style={styles.panelName} numberOfLines={1}>{current.name}</Text>
              <Text style={styles.sub}>{REP_LABEL[repeat]}</Text>
            </View>
          </View>
          <Slider
            style={{ width: '100%', height: 36, marginTop: 6 }}
            minimumValue={0}
            maximumValue={status.duration > 0 ? status.duration : 1}
            value={seekVal ?? status.currentTime ?? 0}
            minimumTrackTintColor={C.accent}
            maximumTrackTintColor={C.surface2}
            thumbTintColor={C.accent}
            onValueChange={setSeekVal}
            onSlidingComplete={(v) => { player.seekTo(v); setSeekVal(null); }}
          />
          <View style={styles.times}>
            <Text style={styles.sub}>{fmtTime(seekVal ?? status.currentTime)}</Text>
            <Text style={styles.sub}>{fmtTime(status.duration)}</Text>
          </View>
          <View style={styles.controls}>
            <IconBtn
              name={repeat === 'one' ? 'repeat' : 'repeat'}
              color={repeat === 'off' ? C.muted : C.accent}
              onPress={() => setRepeat(REP_NEXT[repeat])}
              label="Modo de repetição"
              style={repeat === 'one' ? styles.repOne : null}
            />
            <IconBtn name="play-skip-back" size={28} onPress={prevTrack} label="Anterior" />
            <Pressable onPress={togglePlay} style={styles.playBtn} accessibilityLabel="Tocar ou pausar">
              <Ionicons name={status.playing ? 'pause' : 'play'} size={34} color={C.onAccent} />
            </Pressable>
            <IconBtn name="play-skip-forward" size={28} onPress={() => nextTrack(false)} label="Próxima" />
            <View style={styles.iconBtn} />
          </View>
        </View>
      )}

      <Modal visible={!!editing} transparent animationType="slide" onRequestClose={() => setEditing(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBg}>
          <View style={[styles.sheet, { paddingBottom: 20 + insets.bottom }]}>
            <Text style={styles.sheetTitle}>Editar música</Text>
            {editing && (
              <View style={styles.coverRow}>
                <Cover track={{ name: editing.name, cover: editing.cover }} size={96} radius={12} />
                <View style={{ gap: 8 }}>
                  <Pressable style={styles.ghost} onPress={pickCover}><Text style={styles.ghostTxt}>Trocar foto</Text></Pressable>
                  <Pressable style={styles.ghost} onPress={() => setEditing((e) => ({ ...e, cover: null }))}>
                    <Text style={styles.ghostTxt}>Remover foto</Text>
                  </Pressable>
                </View>
              </View>
            )}
            <Text style={styles.label}>Nome</Text>
            <TextInput
              value={editing?.name ?? ''}
              onChangeText={(v) => setEditing((e) => ({ ...e, name: v }))}
              style={styles.input}
              maxLength={120}
              placeholderTextColor={C.muted}
            />
            <View style={styles.sheetActions}>
              <Pressable onPress={deleteTrack}><Text style={{ color: C.danger, fontWeight: '600' }}>Excluir música</Text></Pressable>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Pressable style={styles.ghost} onPress={() => setEditing(null)}><Text style={styles.ghostTxt}>Cancelar</Text></Pressable>
                <Pressable style={styles.addBtn} onPress={saveEdit}><Text style={styles.addTxt}>Salvar</Text></Pressable>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <Main />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', alignItems: 'flex-end', gap: 12, padding: 16, paddingTop: 20 },
  h1: { color: C.text, fontSize: 30, fontWeight: '800', letterSpacing: -0.5 },
  muted: { color: C.muted, fontSize: 13, marginTop: 4 },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.accent,
    paddingHorizontal: 18, minHeight: 44, borderRadius: 999, justifyContent: 'center',
  },
  addTxt: { color: C.onAccent, fontWeight: '700', fontSize: 15 },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface, borderRadius: 14, padding: 6 },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  name: { color: C.text, fontWeight: '600', fontSize: 16 },
  sub: { color: C.muted, fontSize: 13 },
  iconBtn: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 24 },
  repOne: { borderWidth: 1.5, borderColor: C.accent },
  empty: { borderWidth: 2, borderStyle: 'dashed', borderColor: 'rgba(238,242,234,.15)', borderRadius: 20, padding: 28, marginTop: 8 },
  emptyTitle: { color: C.text, fontSize: 20, fontWeight: '700', textAlign: 'center', marginBottom: 8 },
  emptyTxt: { color: C.muted, textAlign: 'center', lineHeight: 21 },
  panel: {
    position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: C.surface2,
    borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 18, paddingTop: 16,
  },
  panelTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  panelName: { color: C.text, fontSize: 18, fontWeight: '700' },
  times: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
  playBtn: { width: 68, height: 68, borderRadius: 34, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,.55)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 22, gap: 12 },
  sheetTitle: { color: C.text, fontSize: 20, fontWeight: '800' },
  coverRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  ghost: { backgroundColor: C.surface2, paddingHorizontal: 16, minHeight: 44, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  ghostTxt: { color: C.text, fontWeight: '600' },
  label: { color: C.text, fontWeight: '600', marginTop: 4 },
  input: { backgroundColor: C.bg, color: C.text, borderRadius: 12, paddingHorizontal: 14, minHeight: 48, fontSize: 16 },
  sheetActions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
});
